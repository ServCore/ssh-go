import { computed, readonly, ref } from "vue";
import * as api from "../lib/api";

export interface TerminalFont {
  family: string;
  size: number;
}
export const defaultTerminalFont: Readonly<TerminalFont> = { family: "手札体-简", size: 13 };
const preferenceKey = "terminal.font";
const storageKey = "ssh-go.terminal.font";
function valid(value: unknown): value is TerminalFont {
  if (!value || typeof value !== "object") return false;
  const font = value as TerminalFont;
  return typeof font.family === "string" && font.family.trim().length > 0 && font.family.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(font.family) && Number.isInteger(font.size) && font.size >= 8 && font.size <= 32;
}
function cached(): TerminalFont {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (valid(value)) return { family: value.family.trim(), size: value.size };
  } catch { /* Desktop preferences can still restore the font. */ }
  return { ...defaultTerminalFont };
}
const font = ref<TerminalFont>(cached());
export const terminalFont = readonly(font);
export function fontFamilyCSS(family: string) {
  const name = family.trim();
  if (name === "monospace") return "monospace";
  const requested = ["手札体-简", "手扎体-简", "Hannotate SC", "HannotateSC-W5"].includes(name)
    ? '"Hannotate SC", "手札体-简"' : JSON.stringify(name || defaultTerminalFont.family);
  return `${requested}, Menlo, Monaco, "SFMono-Regular", monospace`;
}
export const terminalFontFamily = computed(() => fontFamilyCSS(font.value.family));
let revision = 0;
let saveQueue = Promise.resolve();
function cache() {
  try { localStorage.setItem(storageKey, JSON.stringify(font.value)); }
  catch { /* The desktop store remains available if browser storage is blocked. */ }
}
export const terminalFontRevision = () => revision;
export function restoreTerminalFont(preferences: Record<string, unknown>, startedAt: number) {
  const saved = preferences[preferenceKey];
  if (revision === startedAt && valid(saved)) {
    font.value = { family: saved.family.trim(), size: saved.size };
    cache();
  }
}
export async function setTerminalFont(value: TerminalFont) {
  if (!valid(value)) throw new Error("请输入有效的本机字体名称，字号范围为 8–32。");
  revision++;
  const next = { family: value.family.trim(), size: value.size };
  font.value = next;
  cache();
  if (!api.desktopAvailable) return;
  const saved = saveQueue.then(() => api.setPreference(preferenceKey, next));
  saveQueue = saved.catch(() => {});
  await saved;
}
