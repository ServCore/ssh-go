export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error)
    return String(error.message);
  return String(error);
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 1 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}
export function joinPath(path: string, name: string): string {
  return `${path.replace(/\/$/, "")}/${name}`;
}
export function parentPath(path: string): string {
  return path.replace(/\/$/, "").replace(/\/[^/]*$/, "") || "/";
}
