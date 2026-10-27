import type { Terminal, IDecoration, IDisposable, IMarker } from "@xterm/xterm";

export interface OutputHighlightOptions {
  enabled: boolean;
  dark: boolean;
  visible: boolean;
}
type BufferLine = NonNullable<
  ReturnType<Terminal["buffer"]["active"]["getLine"]>
>;
export type HighlightTone =
  "blue" | "cyan" | "green" | "magenta" | "yellow" | "red" | "muted";
export interface TextHighlight {
  start: number;
  end: number;
  tone: HighlightTone;
}
export interface CellHighlight {
  x: number;
  width: number;
  tone: HighlightTone;
}
export interface ReadLine {
  text: string;
  // UTF-16 string offsets map to entire terminal cells (including combining text).
  cells: { start: number; end: number }[];
  nativeStyle: boolean;
}
export const OUTPUT_HIGHLIGHT_LIMITS = {
  contextRows: 200,
  visibleRows: 160,
  decorations: 768,
  delayMs: 50,
  logicalRows: 8,
};
const palettes: Record<"light" | "dark", Record<HighlightTone, string>> = {
  light: {
    blue: "#285BB5",
    cyan: "#087985",
    green: "#217B4C",
    magenta: "#9550A4",
    yellow: "#93620C",
    red: "#BA414C",
    muted: "#69758B",
  },
  dark: {
    blue: "#89B4FA",
    cyan: "#79D2D6",
    green: "#9AD49F",
    magenta: "#CFACF2",
    yellow: "#E8C47B",
    red: "#F1919A",
    muted: "#99A8C0",
  },
};
type TableField =
  | "REPOSITORY"
  | "TAG"
  | "IMAGE ID"
  | "CREATED"
  | "SIZE"
  | "CONTAINER ID"
  | "IMAGE"
  | "COMMAND"
  | "STATUS"
  | "PORTS"
  | "NAMES";
export interface OutputTable {
  kind: "images" | "containers";
  columns: { field: TableField; start: number }[];
}
const fieldTones: Record<TableField, HighlightTone> = {
  REPOSITORY: "cyan",
  TAG: "green",
  "IMAGE ID": "magenta",
  CREATED: "muted",
  SIZE: "yellow",
  "CONTAINER ID": "magenta",
  IMAGE: "cyan",
  COMMAND: "muted",
  STATUS: "muted",
  PORTS: "yellow",
  NAMES: "blue",
};
const age =
  /^(?:\d+ (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)|About (?:a|an|\d+) (?:second|minute|hour|day|week|month|year)|Less than a second) ago$/;
function statusTone(value: string): HighlightTone | null {
  if (/^(?:Dead|Removing)\b/i.test(value) || /\(unhealthy\)/i.test(value))
    return "red";
  if (
    /^(?:Restarting|Created|Paused)\b/i.test(value) ||
    /\((?:Paused|health: starting)\)/i.test(value)
  )
    return "yellow";
  const exited = value.match(/^Exited \((-?\d+)\)/);
  if (exited) return exited[1] === "0" ? "muted" : "red";
  if (/^Up(?:\s|$)/.test(value)) return "green";
  return null;
}
function tableHeader(text: string): OutputTable | null {
  const tokens = [...text.matchAll(/\S(?:.*?\S)?(?= {2,}|$)/g)];
  const fields = tokens.map((token) => token[0]);
  const images = fields.join("|") === "REPOSITORY|TAG|IMAGE ID|CREATED|SIZE";
  const containers =
    fields[0] === "CONTAINER ID" &&
    fields.includes("IMAGE") &&
    fields.includes("STATUS") &&
    fields.includes("NAMES") &&
    new Set(fields).size === fields.length &&
    fields.every((field) => Object.hasOwn(fieldTones, field));
  if (!images && !containers) return null;
  return {
    kind: images ? "images" : "containers",
    columns: tokens.map((token) => ({
      field: token[0] as TableField,
      start: token.index!,
    })),
  };
}
function tableRow(text: string, table: OutputTable): TextHighlight[] | null {
  // Images have no empty columns or quoted commands. Container rows use the
  // header's boundaries so empty PORTS and double spaces inside COMMAND survive.
  const values =
    table.kind === "images"
      ? [...text.matchAll(/\S(?:.*?\S)?(?= {2,}|$)/g)].map((token) => ({
          value: token[0],
          start: token.index!,
        }))
      : table.columns.map((column, index) => {
          const end = table.columns[index + 1]?.start ?? text.length;
          const raw = text.slice(column.start, end);
          return {
            value: raw.trim(),
            start: column.start + raw.length - raw.trimStart().length,
          };
        });
  if (values.length !== table.columns.length) return null;
  const fields = Object.fromEntries(
    table.columns.map((column, index) => [column.field, values[index].value]),
  );
  if (table.kind === "images") {
    if (
      !fields.REPOSITORY ||
      !fields.TAG ||
      !/^(?:[a-f0-9]{12,64}|<none>)$/.test(fields["IMAGE ID"]) ||
      !age.test(fields.CREATED) ||
      !/^\d+(?:\.\d+)?\s?[kMGTPE]?B$/.test(fields.SIZE)
    )
      return null;
  } else if (
    !/^[a-f0-9]{12,64}$/.test(fields["CONTAINER ID"]) ||
    !fields.IMAGE ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.\/,=-]*$/.test(fields.NAMES) ||
    !statusTone(fields.STATUS) ||
    (fields.CREATED !== undefined && !age.test(fields.CREATED))
  )
    return null;
  return values.flatMap((cell, index) =>
    cell.value
      ? [
          {
            start: cell.start,
            end: cell.start + cell.value.length,
            tone:
              table.columns[index].field === "STATUS"
                ? statusTone(cell.value)!
                : fieldTones[table.columns[index].field],
          },
        ]
      : [],
  );
}
function captureSpans(
  match: RegExpMatchArray,
  tones: HighlightTone[],
): TextHighlight[] {
  let from = 0;
  return tones.map((tone, index) => {
    const value = match[index + 1];
    const start = match[0].indexOf(value, from);
    from = start + value.length;
    return { start, end: from, tone };
  });
}
/** Recognize deliberately narrow, completed output patterns, never shell input. */
export function classifyOutputLine(
  text: string,
  previousTable: OutputTable | null,
): { spans: TextHighlight[]; table: OutputTable | null } {
  const table = tableHeader(text);
  if (table)
    return {
      spans: table.columns.map((column) => ({
        start: column.start,
        end: column.start + column.field.length,
        tone: "blue",
      })),
      table,
    };
  const row = previousTable ? tableRow(text, previousTable) : null;
  if (row) return { spans: row, table: previousTable };
  const prompt = text.match(
    /^\[([^@\]\s]+)@([^\]\s]+)\s+([^\]]+)\][#$](?:\s+(\S+))?/,
  );
  if (prompt) {
    const spans = captureSpans(prompt, [
      prompt[1] === "root" ? "red" : "green",
      "cyan",
      "blue",
    ]);
    if (prompt[4]) {
      const start = prompt[0].lastIndexOf(prompt[4]);
      spans.push({ start, end: start + prompt[4].length, tone: "magenta" });
    }
    return { spans, table: null };
  }
  if (
    /^Last failed login: .+/.test(text) ||
    /^There were \d+ failed login attempts since the last successful login\.$/.test(
      text,
    )
  ) {
    return {
      spans: [{ start: 0, end: text.length, tone: "red" }],
      table: null,
    };
  }
  return { spans: [], table: null };
}
export function readOutputLine(
  line: BufferLine,
  columns: number,
  trim = true,
): ReadLine {
  let text = "";
  let nativeStyle = false;
  const cells: ReadLine["cells"] = [];
  for (let column = 0; column < Math.min(columns, line.length); column++) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    const width = Math.max(1, cell.getWidth());
    const chars = cell.getChars() || " ";
    text += chars;
    for (let offset = 0; offset < chars.length; offset++)
      cells.push({ start: column, end: column + width });
    // Native ANSI always owns its colors and attributes. Also inspect colored blanks.
    nativeStyle ||=
      !cell.isFgDefault() ||
      !cell.isBgDefault() ||
      !!cell.isInverse() ||
      !!cell.isInvisible();
  }
  if (trim) text = text.trimEnd();
  cells.length = text.length;
  return { text, cells, nativeStyle };
}
export function toCellHighlights(
  line: ReadLine,
  spans: TextHighlight[],
): CellHighlight[] {
  if (line.nativeStyle) return [];
  return spans.flatMap((span) => {
    const first = line.cells[span.start];
    const last = line.cells[span.end - 1];
    return first && last && last.end > first.start
      ? [{ x: first.start, width: last.end - first.start, tone: span.tone }]
      : [];
  });
}
interface DecoratedRow {
  marker: IMarker;
  decorations: IDecoration[];
  signature: string;
}
/** Foreground overlays only: terminal bytes, parsed buffer, selection and copy stay untouched. */
export class TerminalOutputHighlighter {
  private options: OutputHighlightOptions;
  private rows: DecoratedRow[] = [];
  private listeners: IDisposable[] = [];
  private bufferListener: IDisposable | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  constructor(
    private terminal: Terminal,
    options: OutputHighlightOptions,
  ) {
    this.options = { ...options };
    this.syncListeners();
  }
  update(options: OutputHighlightOptions): void {
    if (this.disposed) return;
    const changed = this.options.dark !== options.dark;
    this.options = { ...options };
    if (changed) this.clearRows();
    this.syncListeners();
    this.schedule();
  }
  dispose(): void {
    this.disposed = true;
    this.stopListeners();
    this.clearRows();
  }
  private eligible(): boolean {
    return !this.disposed && this.options.enabled && this.options.visible;
  }
  private syncListeners(): void {
    if (!this.eligible()) {
      this.stopListeners();
      this.clearRows();
      return;
    }
    this.bufferListener ??= this.terminal.buffer.onBufferChange(() => {
      this.clearRows();
      this.syncListeners();
      this.schedule();
    });
    if (this.terminal.buffer.active.type === "alternate") {
      this.stopNormalListeners();
      this.clearRows();
      return;
    }
    if (!this.listeners.length) {
      this.listeners = [
        this.terminal.onWriteParsed(() => this.schedule()),
        this.terminal.onScroll(() => this.schedule()),
        this.terminal.onResize(() => {
          this.clearRows();
          this.schedule();
        }),
      ];
      this.schedule();
    }
  }
  private stopNormalListeners(): void {
    for (const listener of this.listeners) listener.dispose();
    this.listeners = [];
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private stopListeners(): void {
    this.stopNormalListeners();
    this.bufferListener?.dispose();
    this.bufferListener = undefined;
  }
  private clearRows(): void {
    for (const row of this.rows) this.disposeRow(row);
    this.rows = [];
  }
  private disposeRow(row: DecoratedRow): void {
    for (const decoration of row.decorations) decoration.dispose();
    row.marker.dispose();
  }
  private schedule(): void {
    if (
      !this.eligible() ||
      this.terminal.buffer.active.type !== "normal" ||
      this.timer !== undefined
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refresh();
    }, OUTPUT_HIGHLIGHT_LIMITS.delayMs);
  }
  private refresh(): void {
    if (!this.eligible() || this.terminal.buffer.active.type !== "normal")
      return;
    const buffer = this.terminal.buffer.active;
    const cursorLine = buffer.baseY + buffer.cursorY;
    const start = Math.max(0, buffer.viewportY);
    const end = Math.min(
      buffer.length,
      start + Math.min(this.terminal.rows, OUTPUT_HIGHLIGHT_LIMITS.visibleRows),
    );
    const desired = new Map<number, CellHighlight[]>();
    let table: OutputTable | null = null;
    let count = 0;
    for (
      let index = Math.max(0, start - OUTPUT_HIGHLIGHT_LIMITS.contextRows);
      index < end;
      index++
    ) {
      const source = buffer.getLine(index);
      if (!source || source.isWrapped) {
        table = null;
        continue;
      }
      const sources = [source];
      while (
        sources.length < OUTPUT_HIGHLIGHT_LIMITS.logicalRows &&
        buffer.getLine(index + sources.length)?.isWrapped
      )
        sources.push(buffer.getLine(index + sources.length)!);
      const logicalEnd = index + sources.length;
      const oversized = buffer.getLine(logicalEnd)?.isWrapped;
      if (oversized || (cursorLine >= index && cursorLine < logicalEnd)) {
        table = null;
        index = logicalEnd - 1;
        continue;
      }
      const text = sources
        .map((line, offset) =>
          line.translateToString(
            offset === sources.length - 1,
            0,
            this.terminal.cols,
          ),
        )
        .join("");
      const classified = classifyOutputLine(text, table);
      table = classified.table;
      if (
        logicalEnd > start &&
        classified.spans.length &&
        (sources.length === 1 || table)
      ) {
        const read: ReadLine = { text: "", cells: [], nativeStyle: false };
        sources.forEach((line, offset) => {
          const part = readOutputLine(
            line,
            this.terminal.cols,
            offset === sources.length - 1,
          );
          read.text += part.text;
          read.nativeStyle ||= part.nativeStyle;
          read.cells.push(
            ...part.cells.map((cell) => ({
              start: cell.start + offset * this.terminal.cols,
              end: cell.end + offset * this.terminal.cols,
            })),
          );
        });
        for (const span of toCellHighlights(read, classified.spans)) {
          const spanEnd = span.x + span.width;
          for (
            let offset = Math.floor(span.x / this.terminal.cols);
            offset <= Math.floor((spanEnd - 1) / this.terminal.cols);
            offset++
          ) {
            const row = index + offset;
            if (
              row < start ||
              row >= end ||
              count >= OUTPUT_HIGHLIGHT_LIMITS.decorations
            )
              continue;
            const x = Math.max(span.x - offset * this.terminal.cols, 0);
            const width =
              Math.min(
                spanEnd - offset * this.terminal.cols,
                this.terminal.cols,
              ) - x;
            const spans = desired.get(row) || [];
            spans.push({ x, width, tone: span.tone });
            desired.set(row, spans);
            count++;
          }
        }
      }
      index = logicalEnd - 1;
    }
    const retained: DecoratedRow[] = [];
    for (const row of this.rows) {
      const spans = desired.get(row.marker.line);
      if (
        !row.marker.isDisposed &&
        spans &&
        row.signature === JSON.stringify(spans)
      ) {
        retained.push(row);
        desired.delete(row.marker.line);
      } else this.disposeRow(row);
    }
    const palette = palettes[this.options.dark ? "dark" : "light"];
    for (const [index, spans] of desired) {
      const marker = this.terminal.registerMarker(index - cursorLine);
      if (!marker || marker.isDisposed) continue;
      const decorations: IDecoration[] = [];
      for (const span of spans) {
        const decoration = this.terminal.registerDecoration({
          marker,
          x: span.x,
          width: span.width,
          foregroundColor: palette[span.tone],
          layer: "bottom",
        });
        if (decoration) decorations.push(decoration);
      }
      if (decorations.length)
        retained.push({
          marker,
          decorations,
          signature: JSON.stringify(spans),
        });
      else marker.dispose();
    }
    this.rows = retained;
  }
}
