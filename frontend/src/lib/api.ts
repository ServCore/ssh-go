import type {
  HostConfig,
  RemoteSystem,
  SessionInfo,
  TerminalInfo,
  TerminalEvent,
  FileEndpoint,
  FileEntry,
  TransferRequest,
  TransferInfo,
  ResourceSnapshot,
  KnownHost,
  HostImportPreview,
  HostImportResult,
  PortForwardInfo,
} from "./types";

declare global {
  interface Window {
    go?: {
      main: {
        App: {
          Call(
            command: string,
            args: Record<string, unknown>,
          ): Promise<unknown>;
        };
      };
    };
    runtime?: {
      Environment?(): Promise<{ platform: string }>;
      EventsOn(name: string, callback: (payload: unknown) => void): () => void;
    };
  }
}

export const desktopAvailable = Boolean(window.go?.main?.App && window.runtime);
function listen<T>(
  name: string,
  callback: (event: { payload: T }) => void,
): Promise<() => void> {
  return Promise.resolve(
    window.runtime!.EventsOn(name, (payload) =>
      callback({ payload: payload as T }),
    ),
  );
}
const open = (options: Record<string, unknown>) =>
  call<string | string[] | null>("dialog_open", options);
const save = (options: Record<string, unknown>) =>
  call<string | null>("dialog_save", options);
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktopAvailable)
    return Promise.reject({
      code: "desktop_required",
      message: "请使用桌面应用连接 SSH 与访问文件。",
    });
  return window.go!.main.App.Call(command, args ?? {}) as Promise<T>;
}
export const listHosts = () => call<HostConfig[]>("list_hosts");
export const saveHost = (host: HostConfig, password?: string) =>
  call<HostConfig>("save_host", { host, password: password ?? null });
export const deleteHost = (id: string) => call<void>("delete_host", { id });
export const duplicateHost = (id: string) =>
  call<HostConfig>("duplicate_host", { id });
export const listKnownHosts = () => call<KnownHost[]>("list_known_hosts");
export const forgetKnownHost = (
  address: string,
  port: number,
  expectedFingerprint: string,
) => call<void>("forget_known_host", { address, port, expectedFingerprint });
export const previewHostImport = (path: string, format: "json" | "openssh") =>
  call<HostImportPreview>("preview_host_import", { path, format });
export const importHosts = (hosts: HostConfig[]) =>
  call<HostImportResult>("import_hosts", { hosts });
export const exportHosts = (path: string) =>
  call<void>("export_hosts", { path });
export async function chooseSshPrivateKey(): Promise<string | null> {
  if (!desktopAvailable) return null;
  const result = await open({
    title: "选择 SSH 私钥",
    multiple: false,
    directory: false,
  });
  return typeof result === "string" ? result : null;
}
export async function chooseHostImport(
  format: "json" | "openssh",
): Promise<string | null> {
  if (!desktopAvailable) return null;
  const result = await open({
    title: format === "json" ? "导入服务器配置" : "导入 OpenSSH 配置",
    multiple: false,
    directory: false,
    ...(format === "json"
      ? { filters: [{ name: "ssh-go 配置", extensions: ["json"] }] }
      : {}),
  });
  return typeof result === "string" ? result : null;
}
export async function chooseHostExport(): Promise<string | null> {
  if (!desktopAvailable) return null;
  const result = await save({
    title: "导出服务器配置",
    defaultPath: "ssh-go-hosts.json",
    filters: [{ name: "ssh-go 配置", extensions: ["json"] }],
  });
  return result ? (/\.json$/i.test(result) ? result : `${result}.json`) : null;
}
export const listLocalForwards = (sessionId: string) =>
  call<PortForwardInfo[]>("list_local_forwards", { sessionId });
export const startLocalForward = (
  sessionId: string,
  remoteHost: string,
  remotePort: number,
  localPort: number,
) =>
  call<PortForwardInfo>("start_local_forward", {
    sessionId,
    remoteHost,
    remotePort,
    localPort,
  });
export const stopLocalForward = (id: string) =>
  call<void>("stop_local_forward", { id });
export const listTransferRecoveries = () =>
  call<import("./types").TransferRecoveryInfo[]>("list_transfer_recoveries");
export const recoverTransfer = (
  id: string,
  action: "restore" | "discard",
  sessionId?: string,
) =>
  call<void>("recover_transfer", { id, action, sessionId: sessionId ?? null });
export const connectHost = (
  hostId: string,
  password?: string,
  acceptedFingerprint?: string,
  requestId?: string,
  acceptedHostId?: string,
) =>
  call<SessionInfo>("connect_host", {
    hostId,
    password: password ?? null,
    acceptedFingerprint: acceptedFingerprint ?? null,
    requestId: requestId ?? null,
    acceptedHostId: acceptedHostId ?? null,
  });
export const cancelHostConnection = (requestId: string) =>
  call<void>("cancel_host_connection", { requestId });
export const disconnectSession = (id: string) =>
  call<void>("disconnect_session", { id });
export const detectHostSystem = (sessionId: string) =>
  call<RemoteSystem | null>("detect_host_system", { sessionId });
export const getServerMetrics = (sessionId: string) =>
  call<import("./types").ServerMetrics>("get_server_metrics", { sessionId });
export const onSessionClosed = (
  callback: (event: { sessionId: string; reason: string }) => void,
) =>
  desktopAvailable
    ? listen<{ sessionId: string; reason: string }>("session-closed", (event) =>
        callback(event.payload),
      )
    : Promise.resolve(() => {});
export async function openTerminal(
  sessionId: string,
  cols: number,
  rows: number,
  onEvent: (event: TerminalEvent) => void,
) {
  // Subscribe before opening the channel: shells can print their prompt before
  // the RPC resolves. Each terminal has an independent, bounded event stream.
  const eventName = `terminal:${crypto.randomUUID()}`;
  let ended = false;
  let terminalId: string | undefined;
  const stop = await listen<TerminalEvent>(eventName, ({ payload }) => {
    onEvent(payload);
    if (payload.kind === "closed") {
      ended = true;
      stop();
      if (terminalId) terminalListeners.delete(terminalId);
    }
  });
  try {
    const info = await call<TerminalInfo>("open_terminal", {
      sessionId,
      cols,
      rows,
      eventName,
    });
    terminalId = info.id;
    if (!ended) terminalListeners.set(info.id, stop);
    return info;
  } catch (error) {
    stop();
    throw error;
  }
}
const terminalListeners = new Map<string, () => void>();
export const writeTerminal = (id: string, data: Uint8Array | string) =>
  call<void>("write_terminal", {
    id,
    data: Array.from(
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    ),
  });
export const resizeTerminal = (id: string, cols: number, rows: number) =>
  call<void>("resize_terminal", { id, cols, rows });
export async function closeTerminal(id: string) {
  try {
    await call<void>("close_terminal", { id });
  } finally {
    terminalListeners.get(id)?.();
    terminalListeners.delete(id);
  }
}
export const ackTerminal = (id: string, bytes: number) =>
  call<void>("ack_terminal", { id, bytes });
export const listFiles = (endpoint: FileEndpoint, path: string) =>
  call<FileEntry[]>("list_files", { endpoint, path });
export const resolveFilePath = (endpoint: FileEndpoint, path: string) =>
  call<string>("resolve_file_path", { endpoint, path });
export const createFile = (endpoint: FileEndpoint, path: string) =>
  call<void>("create_file", { endpoint, path });
export const mkdirFile = (endpoint: FileEndpoint, path: string) =>
  call<void>("mkdir_file", { endpoint, path });
export const renameFile = (
  endpoint: FileEndpoint,
  source: string,
  destination: string,
) => call<void>("rename_file", { endpoint, source, destination });
export const deleteFile = (
  endpoint: FileEndpoint,
  path: string,
  isDirectory: boolean,
) => call<void>("delete_file", { endpoint, path, isDirectory });
export const startTransfer = (request: TransferRequest) =>
  call<TransferInfo>("start_transfer", { request });
export const listTransfers = () => call<TransferInfo[]>("list_transfers");
export const cancelTransfer = (id: string) =>
  call<void>("cancel_transfer", { id });
export const retryTransfer = (id: string) =>
  call<TransferInfo>("retry_transfer", { id });
export const onTransferUpdate = (callback: (transfer: TransferInfo) => void) =>
  desktopAvailable
    ? listen<TransferInfo>("transfer-update", (event) =>
        callback(event.payload),
      )
    : Promise.resolve(() => {});
export const getHomeDirectory = () => call<string>("get_home_directory");
export const getDataDirectory = () => call<string>("get_data_directory");
export const getResourceSnapshot = () =>
  call<ResourceSnapshot>("get_resource_snapshot");
export const getPreferences = () =>
  call<Record<string, unknown>>("get_preferences");
export const setPreference = (key: string, value: unknown) =>
  call<void>("set_preference", { key, value });
export async function chooseLocalFiles(): Promise<string[]> {
  if (!desktopAvailable) return [];
  const result = await open({
    title: "选择要上传的文件",
    multiple: true,
    directory: false,
  });
  return result === null ? [] : Array.isArray(result) ? result : [result];
}
export async function chooseLocalDirectory(): Promise<string | null> {
  if (!desktopAvailable) return null;
  const result = await open({
    title: "选择目录",
    directory: true,
    multiple: false,
  });
  return typeof result === "string" ? result : null;
}
export const confirmAction = (title: string, message: string) =>
  desktopAvailable
    ? call<boolean>("dialog_confirm", { title, message })
    : Promise.resolve(window.confirm(message));
