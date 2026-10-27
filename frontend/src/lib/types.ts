export interface AppError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
export interface RemoteSystem {
  id: string;
  name: string;
  version: string | null;
}
// rememberPassword reports stored credentials; password saving is automatic.
export interface HostConfig {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  group: string;
  rememberPassword: boolean;
  remoteSystem?: RemoteSystem | null;
  authMethod?: "password" | "privateKey" | "agent";
  privateKeyPath?: string | null;
  jumpHostId?: string | null;
}
export interface KnownHost {
  address: string;
  port: number;
  fingerprint: string;
}
export interface HostImportPreview {
  hosts: HostConfig[];
  warnings: string[];
}
export interface HostImportResult {
  imported: number;
  skipped: number;
}
export interface PortForwardInfo {
  id: string;
  sessionId: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}
export interface TransferRecoveryInfo {
  id: string;
  name: string;
  hostId: string | null;
  finalPath: string;
  stagingPath: string;
  backupPath: string | null;
  phase: string;
}
export interface SessionInfo {
  id: string;
  hostId: string;
  hostName: string;
  fingerprint: string;
}
export interface TerminalInfo {
  id: string;
  sessionId: string;
}
export type TerminalEvent =
  | { kind: "output"; data: number[] }
  | { kind: "closed"; reason: string }
  | { kind: "error"; message: string };
export type FileEndpoint =
  { kind: "local" } | { kind: "remote"; sessionId: string };
export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  modified: number | null;
}
export interface TransferRequest {
  source: FileEndpoint;
  destination: FileEndpoint;
  sourcePath: string;
  destinationPath: string;
  overwrite: boolean;
}
export interface TransferInfo {
  destination: FileEndpoint;
  sessionIds?: string[];
  id: string;
  name: string;
  direction: string;
  status:
    | "queued"
    | "preparing"
    | "running"
    | "committing"
    | "cancelling"
    | "completed"
    | "cancelled"
    | "failed";
  bytesDone: number;
  bytesTotal: number;
  error: string | null;
  sourcePath: string;
  destinationPath: string;
}
export interface DirectoryChange {
  endpoint: FileEndpoint;
  path: string;
}
export interface ResourceSnapshot {
  cpuPercent: number | null;
  memoryBytes: number;
  memoryKind?: "footprint" | "rss" | "peak-rss" | "go-runtime" | "unavailable";
  processCount: number;
  scope: string;
}

export interface ServerMetrics {
  sampledAt: number;
  cpuPercent: number | null;
  cpuCores: number;
  memoryTotal: number;
  memoryUsed: number;
  memoryAvailable: number;
  swapTotal: number;
  swapUsed: number;
  uptimeSeconds: number;
  load: number[];
  networkReceiveRate: number | null;
  networkTransmitRate: number | null;
  disks: {
    filesystem: string;
    mount: string;
    total: number;
    used: number;
    available: number;
    usedPercent: number;
  }[];
  warnings: string[];
}
