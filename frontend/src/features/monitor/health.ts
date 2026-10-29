import { formatBytes } from "../../lib/format";
import type { ServerMetrics } from "../../lib/types";

export type ResourceTone = "normal" | "elevated" | "high" | "unavailable";
export type ResourceKind = "load" | "cpu" | "memory" | "disk";

// These are UI attention thresholds, not a diagnosis of service availability.
const thresholds: Record<ResourceKind, [number, number]> = {
  load: [75, 100], cpu: [75, 90], memory: [80, 90], disk: [80, 90],
};
export function resourceTone(value: number | null | undefined, kind: ResourceKind = "cpu"): ResourceTone {
  if (value == null || !Number.isFinite(value) || value < 0) return "unavailable";
  const [warning, critical] = thresholds[kind];
  return value >= critical ? "high" : value >= warning ? "elevated" : "normal";
}
export function usagePercent(used: number, total: number): number | null {
  return Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0 ? used / total * 100 : null;
}
export function loadPercentOf(sample: ServerMetrics): number | null {
  const load = sample.load[0];
  return load != null && sample.cpuCores > 0 ? load / sample.cpuCores * 100 : null;
}
export function resourceHealth(sample: ServerMetrics) {
  const metrics = [
    { name: "系统负载", value: loadPercentOf(sample), kind: "load" as const },
    { name: "CPU", value: sample.cpuPercent, kind: "cpu" as const },
    { name: "内存", value: usagePercent(sample.memoryUsed, sample.memoryTotal), kind: "memory" as const },
    ...sample.disks.map(disk => ({ name: `${disk.mount} 分区`, available: disk.available, value: disk.total > 0 ? disk.usedPercent : null, kind: "disk" as const })),
  ];
  const assessed = metrics.map(metric => ({ ...metric, tone: resourceTone(metric.value, metric.kind) }));
  // A known pressure condition remains useful even when another metric is missing.
  for (const tone of ["high", "elevated"] as const) {
    const issue = assessed.find(metric => metric.tone === tone);
    if (issue) return {
      tone,
      label: issue.kind === "disk" ? tone === "high" ? "分区空间紧张" : "分区空间提醒"
        : issue.kind === "load" ? tone === "high" ? "负载较高" : "负载偏高"
        : `${issue.name}${tone === "high" ? "使用率很高" : "使用率偏高"}`,
      reason: `${issue.name} · ${issue.kind === "disk" ? "已用" : issue.kind === "load" ? "每核负载" : "使用率"} ${issue.value!.toFixed(1)}%${issue.kind === "disk" && Number.isFinite(issue.available) && issue.available >= 0 ? ` · 可用 ${formatBytes(issue.available)}` : ""}`,
    };
  }
  const missing = assessed.find(metric => metric.tone === "unavailable");
  if (missing || !sample.disks.some(disk => disk.mount === "/")) return {
    tone: "unavailable" as const, label: "正在采样", reason: missing ? `等待${missing.name}采样` : "未读取到根分区数据",
  };
  if (sample.warnings.length) return { tone: "elevated" as const, label: "采样提示", reason: sample.warnings[0]! };
  return { tone: "normal" as const, label: "采样正常", reason: "当前未发现资源压力" };
}
