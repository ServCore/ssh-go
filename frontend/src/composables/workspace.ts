import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
} from "vue";
import type { InjectionKey } from "vue";
import * as api from "../lib/api";
import { appearanceRevision, restoreAppearance } from "./appearance";
import type {
  AppError,
  HostConfig,
  SessionInfo,
  TransferInfo,
  ResourceSnapshot,
  DirectoryChange,
} from "../lib/types";
import { errorMessage, parentPath } from "../lib/format";

export interface SessionView extends SessionInfo {
  closed: boolean;
  terminalClosed: boolean;
  generation: number;
  workspace: "terminal" | "files" | "monitor";
  monitorOpened: boolean;
  filesOpened: boolean;
  filesDocked: boolean;
  appearanceOpen: boolean;
  operation: string;
  detected: boolean;
}
interface Attempt {
  id: string;
  cancelled: boolean;
  replacement?: string;
}
export function createWorkspace() {
  // Hosts are backend snapshots; edits save a separate form and reload this list.
  const hosts = shallowRef<HostConfig[]>([]),
    sessions = ref<SessionView[]>([]),
    view = ref("hosts"),
    settingsOpened = ref(false),
    error = ref(""),
    loading = ref(false);
  const editor = shallowRef<HostConfig | "new" | null>(null),
    selectedHost = ref<string | null>(null),
    group = ref<string | null>(null),
    search = ref(""),
    paletteOpen = ref(false),
    transfersOpen = ref(false),
    forwardID = ref<string | null>(null);
  const attempts = reactive(new Map<string, Attempt>()),
    closing = reactive(new Set<string>()),
    transfers = ref<TransferInfo[]>([]),
    resource = ref<ResourceSnapshot | null>(null);
  const authPrompt = shallowRef<{
    host: HostConfig;
    submit: (secret: string) => Promise<void>;
  } | null>(null);
  const highlight = ref(true),
    active = computed(() => sessions.value.find((s) => s.id === view.value));
  let alive = true;
  let hostsRequest = 0;
  const cleanups: (() => void)[] = [];
  const directoryListeners = new Set<(change: DirectoryChange) => void>();
  function onDirectoryChanged(listener: (change: DirectoryChange) => void) {
    directoryListeners.add(listener);
    return () => { directoryListeners.delete(listener); };
  }
  const activeTransfers = computed(() =>
    transfers.value.filter((t) =>
      ["queued", "preparing", "running", "committing", "cancelling"].includes(
        t.status,
      ),
    ),
  );
  const groups = computed(() =>
    [...new Set(hosts.value.map((h) => h.group))].sort((a, b) =>
      a.localeCompare(b, "zh-CN"),
    ),
  );
  const filtered = computed(() =>
    hosts.value.filter(
      (h) =>
        (group.value === null || h.group === group.value) &&
        [h.name, h.address, h.username, h.group].some((v) =>
          v
            .toLocaleLowerCase()
            .includes(search.value.trim().toLocaleLowerCase()),
        ),
    ),
  );
  async function reloadHosts() {
    const request = ++hostsRequest;
    const next = await api.listHosts();
    if (alive && request === hostsRequest) hosts.value = next;
  }
  function fail(e: unknown) {
    if (alive) error.value = errorMessage(e);
  }
  function showSettings() {
    settingsOpened.value = true;
    view.value = "settings";
  }
  function updateTransfer(t: TransferInfo, notify = true) {
    const index = transfers.value.findIndex((v) => v.id === t.id);
    const previousStatus = transfers.value[index]?.status;
    if (index < 0) transfers.value.push(t);
    else {
      const previous = transfers.value[index]!;
      const ranks: Record<TransferInfo["status"], number> = {
        queued: 0,
        preparing: 1,
        running: 2,
        cancelling: 3,
        committing: 4,
        completed: 5,
        cancelled: 5,
        failed: 5,
      };
      if (
        ranks[t.status] < ranks[previous.status] ||
        t.bytesDone < previous.bytesDone
      )
        return;
      transfers.value[index] = t;
    }
    // Only the first accepted completion invalidates its destination directory.
    // Progress, duplicate completion events and startup history do not trigger IO.
    if (notify && t.status === "completed" && previousStatus !== "completed" && t.destination) {
      const change = { endpoint: t.destination, path: parentPath(t.destinationPath) };
      for (const listener of directoryListeners) listener(change);
    }
  }
  function rememberStop(promise: Promise<() => void>) {
    void promise
      .then((stop) => {
        if (alive) cleanups.push(stop);
        else stop();
      })
      .catch(fail);
  }
  async function connect(
    host: HostConfig,
    password?: string,
    replacement?: string,
    stay = false,
  ) {
    if (attempts.has(host.id)) return;
    if (
      replacement &&
      !sessions.value.some((s) => s.id === replacement && s.closed)
    )
      return;
    const existing = sessions.value.find(
      (s) => s.hostId === host.id && !s.closed,
    );
    if (existing) {
      if (!stay) view.value = existing.id;
      return;
    }
    const attempt = reactive<Attempt>({
      id: crypto.randomUUID(),
      cancelled: false,
      replacement,
    });
    attempts.set(host.id, attempt);
    error.value = "";
    const current = () =>
      alive && !attempt.cancelled && attempts.get(host.id) === attempt;
    try {
      let result: SessionInfo | undefined,
        fingerprint: string | undefined,
        acceptedHostID: string | undefined;
      for (let hop = 0; hop <= 8; hop++) {
        try {
          result = await api.connectHost(
            host.id,
            password,
            fingerprint,
            attempt.id,
            acceptedHostID,
          );
          break;
        } catch (e) {
          if (!current()) return;
          const failure = e as AppError;
          if (
            failure.code !== "host_key_unknown" ||
            typeof failure.details?.fingerprint !== "string"
          )
            throw e;
          fingerprint = failure.details.fingerprint;
          acceptedHostID =
            typeof failure.details.hostId === "string"
              ? failure.details.hostId
              : host.id;
          const address = failure.details.address || host.address,
            port = failure.details.port || host.port;
          const accepted = await api.confirmAction(
            "确认服务器身份",
            `首次连接 ${address}:${port}\n\n服务器指纹：\n${fingerprint}\n\n请与服务器管理员核对，确认后保存此指纹。`,
          );
          if (!accepted || !current()) return;
          attempt.id = crypto.randomUUID();
        }
      }
      if (!result)
        throw new Error("服务器身份确认次数过多，请检查跳板机配置。");
      if (!current()) {
        await api.disconnectSession(result.id).catch(fail);
        return;
      }
      const next: SessionView = {
        ...result,
        closed: false,
        terminalClosed: false,
        generation: 0,
        workspace: "terminal",
        monitorOpened: false,
        filesOpened: false,
        filesDocked: false,
        appearanceOpen: false,
        operation: "交互终端 · 未启用 shell 集成",
        detected: false,
      };
      if (replacement) {
        const index = sessions.value.findIndex((s) => s.id === replacement);
        if (index < 0) {
          await api.disconnectSession(next.id);
          return;
        }
        sessions.value.splice(index, 1, next);
      } else sessions.value.push(next);
      if (!stay) view.value = next.id;
    } catch (e) {
      if (!current() || (e as AppError).code === "connection_cancelled") return;
      fail(e);
      const failure = e as AppError;
      if (
        [
          "ssh_auth_failed",
          "authentication_failed",
          "password_required",
          "key_passphrase_required",
          "auth_failed",
          "credential_missing",
        ].includes(failure.code)
      ) {
        let credential = host;
        const id = failure.details?.hostId;
        if (typeof id === "string" && id !== host.id) {
          try {
            const all = await api.listHosts();
            const found = all.find((h) => h.id === id);
            if (!found || !current()) return;
            credential = found;
          } catch (lookupError) {
            if (current()) fail(lookupError);
            return;
          }
        }
        if (credential.authMethod === "agent") return;
        const authHost = credential;
        authPrompt.value = {
          host: authHost,
          submit: async (secret) => {
            if (!alive) return;
            if (
              replacement &&
              !sessions.value.some((s) => s.id === replacement)
            )
              return;
            if (authHost.id !== host.id) {
              await api.saveHost(authHost, secret);
              await reloadHosts();
              await connect(host, undefined, replacement, stay);
            } else await connect(host, secret, replacement, stay);
          },
        };
      }
    } finally {
      if (attempts.get(host.id) === attempt) attempts.delete(host.id);
      password = undefined;
      if (alive) void reloadHosts().catch(fail);
    }
  }
  function cancelConnection(hostID: string) {
    const attempt = attempts.get(hostID);
    if (!attempt) return;
    attempt.cancelled = true;
    attempts.delete(hostID);
    void api.cancelHostConnection(attempt.id).catch(fail);
  }
  async function closeSession(s: SessionView) {
    if (closing.has(s.id)) return;
    closing.add(s.id);
    if (s.closed) cancelConnection(s.hostId);
    try {
      await api.disconnectSession(s.id);
      const index = sessions.value.findIndex((v) => v.id === s.id);
      if (index >= 0) sessions.value.splice(index, 1);
      if (view.value === s.id)
        view.value = sessions.value[Math.max(0, index - 1)]?.id || "hosts";
    } catch (e) {
      fail(e);
    } finally {
      closing.delete(s.id);
    }
  }
  function reconnect(s: SessionView) {
    const host = hosts.value.find((h) => h.id === s.hostId);
    if (!host) {
      error.value = "服务器配置已删除，无法重新连接";
      return;
    }
    void connect(host, undefined, s.id);
  }
  function selectWorkspace(s: SessionView, workspace: SessionView["workspace"]) {
    s.workspace = workspace;
    s.filesOpened ||= workspace === "files";
    s.monitorOpened ||= workspace === "monitor";
    s.appearanceOpen = false;
    s.filesDocked = false;
    view.value = s.id;
  }
  async function removeHost(h: HostConfig) {
    if (
      await api.confirmAction("删除服务器", `删除「${h.name}」的连接配置？`)
    ) {
      await api.deleteHost(h.id);
      await reloadHosts();
      if (selectedHost.value === h.id) selectedHost.value = null;
    }
  }
  async function duplicate(h: HostConfig) {
    try {
      const next = await api.duplicateHost(h.id);
      await reloadHosts();
      selectedHost.value = next.id;
      editor.value = next;
    } catch (e) {
      fail(e);
    }
  }
  function terminalReady(s: SessionView) {
    if (s.detected || s.closed) return;
    s.detected = true;
    void api
      .detectHostSystem(s.id)
      .then((system) => {
        if (system) return reloadHosts();
      })
      .catch(() => {});
  }
  async function setHighlight(value: boolean) {
    highlight.value = value;
    try {
      await api.setPreference("terminal.highlightOutput", value);
    } catch (e) {
      fail(e);
    }
  }
  onMounted(async () => {
    if (!api.desktopAvailable) return;
    loading.value = true;
    rememberStop(
      api.onSessionClosed((event) => {
        const s = sessions.value.find((v) => v.id === event.sessionId);
        if (s) {
          s.closed = true;
          s.terminalClosed = true;
          s.filesDocked = false;
          s.operation = event.reason || "SSH 已断开";
        }
      }),
    );
    rememberStop(
      api.onTransferUpdate((t) => {
        if (alive) updateTransfer(t);
      }),
    );
    const initialAppearanceRevision = appearanceRevision();
    await Promise.allSettled([
      reloadHosts().catch(fail),
      api
        .listTransfers()
        .then((all) => {
          if (alive) for (const t of all) updateTransfer(t, false);
        })
        .catch(fail),
      api
        .getPreferences()
        .then((p) => {
          if (alive) restoreAppearance(p, initialAppearanceRevision);
          if (alive && typeof p["terminal.highlightOutput"] === "boolean")
            highlight.value = p["terminal.highlightOutput"] as boolean;
        })
        .catch(fail),
    ]);
    if (alive) loading.value = false;
    let polling = false;
    const poll = async () => {
      if (!alive || document.hidden || polling) return;
      polling = true;
      try {
        const next = await api.getResourceSnapshot();
        if (alive) resource.value = next;
      } catch {
      } finally {
        polling = false;
      }
    };
    if (!alive) return;
    void poll();
    const timer = window.setInterval(poll, 3000);
    document.addEventListener("visibilitychange", poll);
    cleanups.push(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    });
  });
  onBeforeUnmount(() => {
    alive = false;
    for (const stop of cleanups) stop();
    directoryListeners.clear();
    for (const [id] of attempts) cancelConnection(id);
    for (const s of sessions.value)
      void api.disconnectSession(s.id).catch(() => {});
    authPrompt.value = null;
  });
  return {
    shortcutModifier: /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl",
    hosts,
    sessions,
    view,
    settingsOpened,
    error,
    loading,
    editor,
    selectedHost,
    group,
    search,
    paletteOpen,
    transfersOpen,
    forwardID,
    attempts,
    closing,
    transfers,
    resource,
    authPrompt,
    highlight,
    active,
    activeTransfers,
    groups,
    filtered,
    reloadHosts,
    fail,
    showSettings,
    updateTransfer,
    onDirectoryChanged,
    connect,
    cancelConnection,
    closeSession,
    reconnect,
    selectWorkspace,
    removeHost,
    duplicate,
    terminalReady,
    setHighlight,
  };
}
export type Workspace = ReturnType<typeof createWorkspace>;
export const workspaceKey: InjectionKey<Workspace> = Symbol("ssh-go-workspace");
export function useWorkspace() {
  const workspace = inject(workspaceKey);
  if (!workspace) throw new Error("Workspace provider missing");
  return workspace;
}
