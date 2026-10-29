<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import { getServerMetrics } from "../../lib/api";
import { errorMessage, formatBytes } from "../../lib/format";
import type { AppError, RemoteSystem, ServerMetrics } from "../../lib/types";
import MetricChart from "./MetricChart.vue";
import ResourceGauge from "./ResourceGauge.vue";
import { loadPercentOf, resourceHealth, resourceTone, usagePercent, type ResourceKind, type ResourceTone } from "./health";
const props = defineProps<{
  sessionId: string;
  hostName: string;
  system?: RemoteSystem | null;
  closed: boolean;
  visible: boolean;
}>();
const snapshot = shallowRef<ServerMetrics | null>(null);
const history = shallowRef<ServerMetrics[]>([]);
const error = ref("");
const pending = ref(false);
const paused = ref(false);
const unsupported = ref(false);
const trend = ref<"cpu" | "memory">("cpu");
const pageVisible = ref(!document.hidden);
const enabled = computed(() => props.visible && !props.closed && !paused.value && !unsupported.value && pageVisible.value);
let timer: ReturnType<typeof setTimeout> | undefined;
let freshnessTimer: ReturnType<typeof setTimeout> | undefined;
const expired = ref(false);
const awaitingResume = ref(true);
const maxSampleAge = 15000;
let epoch = 0;
let disposed = false;
const status = computed(() => props.closed ? "已断开 · 采集已停止" : unsupported.value ? "系统暂不支持" : paused.value ? "已暂停 · 保留上次数据" : error.value ? "采样失败 · 数据未更新" : !pageVisible.value ? "窗口隐藏 · 已暂停" : expired.value ? "数据过期 · 等待新采样" : "每 3 秒刷新");
const updated = computed(() => snapshot.value ? new Date(snapshot.value.sampledAt).toLocaleTimeString("zh-CN", { hour12: false }) : "尚未采样");
const rootDisk = computed(() => snapshot.value?.disks.find(d => d.mount === "/"));
const loadPercent = computed(() => snapshot.value ? loadPercentOf(snapshot.value) : null);
const memoryPercent = computed(() => snapshot.value ? usagePercent(snapshot.value.memoryUsed, snapshot.value.memoryTotal) : null);
const readingsCurrent = computed(() => !props.closed && !paused.value && !unsupported.value && !error.value && pageVisible.value && !expired.value && !awaitingResume.value);
const unavailableReason = computed(() => props.closed ? "连接已断开 · 保留最后采样" : unsupported.value ? "系统暂不支持监控" : error.value ? "采样失败 · 保留上次数据" : paused.value ? "采集已暂停 · 保留上次数据" : !pageVisible.value ? "窗口隐藏 · 采集已暂停" : expired.value ? "数据已过期 · 等待新采样" : "等待新采样确认状态");
const health = computed(() => !readingsCurrent.value || !snapshot.value
  ? { tone: "unavailable" as const, label: "状态待确认", reason: unavailableReason.value }
  : resourceHealth(snapshot.value));
function metricState(value: number | null | undefined, kind: ResourceKind): ResourceTone {
  return readingsCurrent.value ? resourceTone(value, kind) : "unavailable";
}
const loadState = computed(() => metricState(loadPercent.value, "load"));
const loadLabel = computed(() => loadState.value === "normal" ? "负载正常"
  : loadState.value === "elevated" ? "负载偏高"
  : loadState.value === "high" ? "负载较高"
  : readingsCurrent.value ? "等待采样" : "状态待确认");
const cpuState = computed(() => metricState(snapshot.value?.cpuPercent, "cpu"));
const memoryState = computed(() => metricState(memoryPercent.value, "memory"));
const diskState = computed(() => metricState(rootDisk.value && rootDisk.value.total > 0 ? rootDisk.value.usedPercent : null, "disk"));
const trendState = computed(() => trend.value === "cpu" ? cpuState.value : memoryState.value);
function metricHint(state: ResourceTone, disk = false) {
  return state === "normal" ? disk ? "空间充足" : "余量充足"
    : state === "elevated" ? disk ? "空间偏紧" : "使用率偏高"
    : state === "high" ? disk ? "空间紧张" : "使用率很高"
    : readingsCurrent.value ? "等待下一次采样" : "上次采样 · 状态待确认";
}
watch(snapshot, sample => {
  clearTimeout(freshnessTimer);
  if (!sample) return;
  const remaining = sample.sampledAt + maxSampleAge - Date.now();
  expired.value = remaining <= 0;
  if (remaining > 0) freshnessTimer = setTimeout(() => { expired.value = true; }, remaining);
});
const end = computed(() => snapshot.value?.sampledAt ?? Date.now());
const cpuPoints = computed(() => history.value.map(s => ({ at: s.sampledAt, value: s.cpuPercent })));
const memoryPoints = computed(() => history.value.map(s => ({ at: s.sampledAt, value: usagePercent(s.memoryUsed, s.memoryTotal) })));
const receivePoints = computed(() => history.value.map(s => ({ at: s.sampledAt, value: s.networkReceiveRate })));
const transmitPoints = computed(() => history.value.map(s => ({ at: s.sampledAt, value: s.networkTransmitRate })));
function percent(value: number | null | undefined) { return value == null ? "—" : `${value.toFixed(1)}%`; }
function rate(value: number | null | undefined) { return value == null ? "—" : `${formatBytes(Math.round(value))}/s`; }
function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分钟`;
}
async function poll() {
  if (disposed || !enabled.value || pending.value) return;
  const request = epoch;
  pending.value = true;
  try {
    const next = await getServerMetrics(props.sessionId);
    if (disposed || request !== epoch || !enabled.value) return;
    snapshot.value = next;
    awaitingResume.value = false;
    history.value = [...history.value.filter(s => s.sampledAt > next.sampledAt - 300000), next].slice(-101);
    error.value = "";
  } catch (e) {
    if (disposed || request !== epoch || !enabled.value) return;
    error.value = errorMessage(e);
    if ((e as AppError)?.code === "monitor_unsupported") unsupported.value = true;
  } finally {
    pending.value = false;
    if (!disposed && enabled.value) timer = setTimeout(() => void poll(), 3000);
  }
}
function restart() {
  epoch++;
  clearTimeout(timer);
  if (enabled.value) void poll();
}
function retry() {
  if (paused.value || unsupported.value) { paused.value = false; unsupported.value = false; }
  else restart();
}
function visibility() { pageVisible.value = !document.hidden; }
watch(enabled, value => {
  if (!value) awaitingResume.value = true;
  restart();
}, { immediate: true });
onMounted(() => document.addEventListener("visibilitychange", visibility));
onBeforeUnmount(() => {
  disposed = true;
  epoch++;
  clearTimeout(timer);
  clearTimeout(freshnessTimer);
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <section class="server-monitor" :class="{ 'readings-stale': snapshot && !readingsCurrent }" aria-label="服务器监控">
    <div class="monitor-scroll">
      <div class="monitor-inner">
        <div v-if="closed" class="monitor-notice" role="status">SSH 连接已断开，以下为最后一次采样。重新连接后开始新的监控记录。</div>
        <div v-if="error" class="monitor-notice monitor-error" role="alert">{{ error }}{{ snapshot ? ' · 当前显示上次成功采样的数据。' : '' }}</div>
        <div v-if="!snapshot && !error" class="monitor-loading" :aria-busy="pending" role="status">
          <AppIcon name="monitor" :size="30" /><h2>{{ closed ? '暂无监控数据' : '正在读取服务器状态…' }}</h2><p>{{ closed ? '连接已断开，请重新连接后打开监控。' : '通过当前 SSH 连接采集，无需安装额外服务。' }}</p>
          <div v-if="!closed" class="loading-bars"><span></span><span></span><span></span></div>
        </div>
        <div v-else-if="!snapshot" class="monitor-empty"><AppIcon name="monitor" :size="32" /><h2>{{ unsupported ? '此服务器暂不支持监控' : '暂时无法读取监控数据' }}</h2><p>第一版支持 Linux，使用普通用户可读取的系统指标。</p></div>
        <template v-if="snapshot">
          <section class="resource-overview" :class="{ 'readings-unavailable': !readingsCurrent }" aria-label="实时资源状态">
            <article class="load-card" :class="loadState" aria-label="系统负载">
              <h2><span class="load-dot"></span>系统负载<span v-if="readingsCurrent" class="health-live">实时</span>
                <svg v-if="loadState !== 'unavailable'" class="health-pulse" viewBox="0 0 76 24" aria-hidden="true"><path class="pulse-base" d="M1 13H23L28 7L34 20L41 3L47 13H75" /><path class="pulse-light" d="M1 13H23L28 7L34 20L41 3L47 13H75" /></svg>
              </h2>
              <div class="load-copy">
                <strong title="1 分钟平均负载">{{ snapshot.load[0]?.toFixed(2) ?? '—' }}<small> / {{ snapshot.cpuCores }} 核</small></strong>
                <span class="load-status">{{ loadLabel }}</span>
              </div>
              <ResourceGauge label="负载占核心数比例" :value="loadPercent" :state="loadState" caption="负载 / 核心数" />
              <div class="load-footnote" :class="health.tone" role="status" aria-label="资源提示" :title="`${health.label}：${health.reason}`">
                <AppIcon :name="health.tone === 'normal' ? 'check' : 'info'" tone="inherit" :size="14" />
                <div><strong v-if="health.tone !== 'normal'">{{ health.label }}</strong><span>{{ health.reason }}</span></div>
              </div>
            </article>
            <div class="resource-metrics">
              <article class="resource-card" :class="cpuState" aria-label="CPU 使用率">
                <h2 class="resource-label">CPU</h2>
                <ResourceGauge label="CPU 使用率" :value="snapshot.cpuPercent" :state="cpuState" />
                <div class="resource-copy"><strong>{{ snapshot.cpuCores }}<small class="resource-unit"> 核心</small></strong><small>{{ metricHint(cpuState) }}</small></div>
              </article>
              <article class="resource-card" :class="memoryState" aria-label="内存使用量">
                <h2 class="resource-label">内存</h2>
                <ResourceGauge label="内存使用率" :value="memoryPercent" :state="memoryState" />
                <div class="resource-copy"><strong class="capacity-value"><em>{{ formatBytes(snapshot.memoryUsed) }}</em><span> / {{ formatBytes(snapshot.memoryTotal) }}</span></strong><small>{{ metricHint(memoryState) }} · 不含可回收缓存</small></div>
              </article>
              <article class="resource-card" :class="diskState" aria-label="根分区使用量">
                <h2 class="resource-label">磁盘 · /</h2>
                <ResourceGauge label="根分区使用率" :value="rootDisk?.usedPercent ?? null" :state="diskState" />
                <div class="resource-copy"><strong v-if="rootDisk" class="capacity-value"><em>{{ formatBytes(rootDisk.used) }}</em><span> / {{ formatBytes(rootDisk.total) }}</span></strong><strong v-else>暂无数据</strong><small>根分区 · {{ metricHint(diskState, true) }}</small></div>
              </article>
            </div>
          </section>
          <div class="monitor-grid">
            <article class="metric-panel network-panel" aria-label="网络速率">
              <div class="section-heading"><h2 class="active-heading">网络流量</h2><span title="非回环网卡合计，可能包含虚拟网卡重复流量">所有非回环网卡</span></div>
              <div class="network-numbers">
                <div><span class="network-label transmit"><i></i>上行速率</span><strong>{{ rate(snapshot.networkTransmitRate) }}</strong></div>
                <div><span class="network-label"><i></i>下行速率</span><strong>{{ rate(snapshot.networkReceiveRate) }}</strong></div>
              </div>
              <MetricChart label="最近 5 分钟网络接收与发送速率趋势" :points="receivePoints" :secondary="transmitPoints" primary-name="下行" secondary-name="上行" :end="end" />
            </article>
            <article class="metric-panel trends-panel" :class="trendState" aria-label="资源趋势">
              <div class="section-heading"><div class="trend-tabs" role="group" aria-label="资源趋势指标">
                <button :class="{ active: trend === 'cpu' }" :aria-pressed="trend === 'cpu'" @click="trend = 'cpu'">CPU</button>
                <button :class="{ active: trend === 'memory' }" :aria-pressed="trend === 'memory'" @click="trend = 'memory'">内存</button>
              </div><span>最近 5 分钟</span></div>
              <div class="trend-summary"><span class="network-label transmit"><i></i>{{ trend === 'cpu' ? 'CPU 使用率' : '内存使用率' }}</span><strong>{{ trend === 'cpu' ? percent(snapshot.cpuPercent) : percent(memoryPercent) }}</strong></div>
              <MetricChart v-if="trend === 'cpu'" label="最近 5 分钟 CPU 使用率趋势" :points="cpuPoints" primary-name="CPU" :end="end" :maximum="100" />
              <MetricChart v-else label="最近 5 分钟内存使用率趋势" :points="memoryPoints" primary-name="内存" :end="end" :maximum="100" />
            </article>
          </div>
          <section class="system-overview" aria-label="系统信息">
            <dl>
              <div><dt><AppIcon name="desktop" :size="13" />操作系统</dt><dd>{{ system ? `${system.name} ${system.version ?? ''}` : 'Linux' }}</dd></div>
              <div><dt>运行时长</dt><dd>{{ uptime(snapshot.uptimeSeconds) }}</dd></div>
              <div><dt>平均负载 <small>1 / 5 / 15 分钟</small></dt><dd>{{ snapshot.load.map(n => n.toFixed(2)).join(' / ') }}</dd></div>
              <div><dt>Swap</dt><dd>{{ snapshot.swapTotal ? `${formatBytes(snapshot.swapUsed)} / ${formatBytes(snapshot.swapTotal)}` : '未启用' }}</dd></div>
            </dl>
          </section>
          <section class="disk-section" aria-label="磁盘分区">
            <div class="disk-heading"><div class="panel-title"><h2>磁盘空间</h2><span class="disk-count">{{ snapshot.disks.length }} 个分区</span></div><span v-if="snapshot.disks.some(d => d.usedPercent >= 90)" class="disk-warning"><AppIcon name="info" :size="13" />部分分区使用率超过 90%</span></div>
            <div class="disk-scroll"><table v-if="snapshot.disks.length"><thead><tr><th>挂载点 / 文件系统</th><th>已用 / 总容量</th><th>可用空间</th><th>使用率</th></tr></thead>
              <tbody><tr v-for="disk in snapshot.disks" :key="`${disk.filesystem}:${disk.mount}`">
                <td><div class="disk-identity"><span class="disk-icon"><AppIcon name="server" :size="17" /></span><div><strong :title="disk.mount">{{ disk.mount }}</strong><small :title="disk.filesystem">{{ disk.filesystem }}</small></div></div></td>
                <td>{{ formatBytes(disk.used) }} / {{ formatBytes(disk.total) }}</td><td>{{ formatBytes(disk.available) }}</td>
                <td><div class="disk-usage" :class="metricState(disk.total > 0 ? disk.usedPercent : null, 'disk')"><div class="disk-track" role="meter" :aria-label="`${disk.mount} 使用率`" :aria-valuenow="Number(disk.usedPercent.toFixed(1))" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: `${disk.usedPercent}%` }"></i></div><span>{{ percent(disk.usedPercent) }}</span></div></td>
              </tr></tbody></table><p v-else class="no-disks">未读取到可用的磁盘分区。</p></div>
          </section>
          <p v-for="warning in snapshot.warnings" :key="warning" class="monitor-warning">{{ warning }}</p>
          <footer class="monitor-footer"><span><AppIcon name="refresh" :size="12" />最后更新 {{ updated }}</span><span>保留本次连接最近 5 分钟的数据 · 切换页面自动暂停</span></footer>
        </template>
      </div>
    </div>
    <Teleport v-if="visible" to="#workspace-monitor-controls">
    <div class="monitor-controls" role="group" aria-label="监控采集控制">
      <span class="monitor-status" role="status" :title="status"><i :class="{ live: readingsCurrent }"></i><span class="monitor-status-copy">{{ status }}</span></span>
      <a-button v-if="!closed && !unsupported" size="small" :aria-pressed="paused" @click="paused = !paused">{{ paused ? '继续采集' : '暂停采集' }}</a-button>
      <a-button size="small" :disabled="closed || pending" aria-label="刷新监控" @click="retry"><template #icon><AppIcon name="refresh" :size="14" /></template>{{ error ? '重试' : '刷新' }}</a-button>
    </div>
    </Teleport>
  </section>
</template>
<style scoped>
.server-monitor { flex: 1; min-height: 0; min-width: 0; position: relative; display: flex; flex-direction: column; overflow: hidden; background: #f3f6f4; --monitor-green: #159e69; --monitor-green-text: #0d875c; --gauge-sheen: 6%; --monitor-amber: #d9a44c; --monitor-warning: #a5630b; --monitor-danger: #ce354c; --metric-color: var(--monitor-green); --gauge-track: #edf2ef; --chart-color: var(--monitor-green); --chart-secondary: var(--monitor-amber); --monitor-border: #e8eeea; --monitor-shadow: 0 2px 5px #243b2d03; font-variant-numeric: tabular-nums; }
:root[data-theme="dark"] .server-monitor { background: var(--workspace); --monitor-green: #4ce7ac; --monitor-green-text: #4ce7ac; --monitor-amber: #e6bc71; --monitor-warning: #f3bd58; --monitor-danger: #ff7d87; --gauge-track: var(--hover); --gauge-track-tint: 23%; --gauge-light-wash: 15%; --gauge-sheen: 32%; --gauge-glow-size: 3px; --gauge-text-glow: 16px; --monitor-border: var(--line); --monitor-shadow: none; }
.monitor-inner { width: 100%; max-width: 1600px; margin: 0 auto; padding: 16px 26px 24px; }
h2 { font-size: 14px; line-height: 22px; font-weight: 600; }
.monitor-scroll { flex: 1; min-height: 0; min-width: 0; overflow: auto; }
.monitor-controls { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.monitor-controls :deep(.arco-btn) { height: var(--control-compact); padding: 0 9px; border-radius: var(--control-radius); font-size: 12px; background: var(--surface); border: 1px solid var(--line); color: var(--subtle); transition: border-color .18s, color .18s, background .18s; }
.monitor-controls :deep(.arco-btn:not(:disabled):hover) { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }
.monitor-controls :deep(.arco-btn:not(:disabled):active) { transform: translateY(1px); }
.monitor-status { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; color: var(--subtle); margin-right: 5px; line-height: 18px; }
.monitor-status i { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.monitor-status i.live { background: var(--green); box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 10%, transparent); }
@media (max-width: 1100px) { .monitor-status-copy { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .monitor-status { margin: 0 4px; } }
.resource-overview { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 2.4fr); gap: 16px; }
.load-card, .resource-metrics { min-width: 0; height: 240px; border: 1px solid var(--monitor-border); border-radius: 16px; }
.load-card { position: relative; padding: 24px; --load-accent: var(--monitor-green); background: var(--surface); overflow: hidden; }
.load-card.elevated { --load-accent: var(--monitor-warning); } .load-card.high { --load-accent: var(--monitor-danger); }
.load-card.unavailable { --load-accent: var(--muted); }
.load-card h2 { display: flex; align-items: center; gap: 8px; color: var(--subtle); font-size: 13px; font-weight: 500; }
.health-pulse { width: 48px; height: 20px; margin-left: 4px; flex-shrink: 0; color: var(--load-accent); fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.pulse-base { opacity: .28; }
.pulse-light { stroke-dasharray: 32 110; stroke-dashoffset: 142; }
.load-card.normal .pulse-light { animation: health-flow 4s linear infinite; }
@keyframes health-flow { to { stroke-dashoffset: 0; } }
.health-live { color: var(--muted); font-size: 10px; margin-left: 2px; font-weight: 400; }
.load-dot { position: relative; flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--load-accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--load-accent) 10%, transparent); }
.load-card.normal .load-dot::after { content: ""; position: absolute; inset: -4px; border: 1px solid var(--load-accent); border-radius: 50%; animation: healthy-breath 4s ease-out infinite; pointer-events: none; }
@keyframes healthy-breath { 0%, 100% { transform: scale(.7); opacity: 0; } 30% { opacity: .4; } 80% { transform: scale(1.5); opacity: 0; } }
.load-copy { position: relative; z-index: 1; margin-top: 27px; width: max-content; }
.load-copy > strong { display: block; color: var(--ink); font-size: 36px; font-weight: 600; letter-spacing: -1px; line-height: 42px; font-variant-numeric: tabular-nums; }
.load-card.unavailable .load-copy > strong { color: var(--muted); }
.load-copy small { color: var(--subtle); font-size: 12px; font-weight: 400; letter-spacing: 0; }
.load-copy > .load-status { display: inline-flex; align-items: center; margin-top: 8px; padding: 2px 6px; border-radius: 4px; color: var(--load-accent); background: color-mix(in srgb, var(--load-accent) 8%, transparent); font-size: 10px; line-height: 16px; }
.load-card :deep(.resource-gauge) { position: absolute; top: 42px; right: 16px; width: 138px; height: 138px; }
.load-footnote { --icon-color: currentColor; position: absolute; bottom: 18px; left: 24px; right: 24px; display: flex; align-items: center; gap: 7px; padding-top: 12px; border-top: 1px solid var(--monitor-border); color: var(--muted); }
.load-footnote > .app-icon { flex-shrink: 0; }
.load-footnote > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.load-footnote strong { font-size: 10px; line-height: 14px; font-weight: 500; }
.load-footnote span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; line-height: 15px; color: var(--subtle); }
.load-footnote.normal > .app-icon { color: var(--monitor-green); }
.load-footnote.elevated { color: var(--monitor-warning); }
.load-footnote.high { color: var(--monitor-danger); }
.load-footnote.unavailable { color: var(--muted); }
.readings-unavailable .resource-copy > strong { color: var(--muted); }
.resource-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: var(--surface); padding: 18px 0; }
.resource-card { position: relative; min-width: 0; text-align: center; border-left: 1px solid var(--monitor-border); }
.resource-card:first-child { border-left: 0; }
.resource-label { font-size: 13px; line-height: 20px; color: var(--subtle); font-weight: 500; }
.resource-card :deep(.resource-gauge) { margin: 6px auto 0; }
.resource-copy { margin: 7px 10px 0; }
.resource-copy > strong { display: block; font-size: 19px; line-height: 25px; font-weight: 600; letter-spacing: -.4px; white-space: nowrap; }
.resource-copy > small { display: block; color: var(--muted); font-size: 10px; line-height: 16px; margin-top: 3px; }
.resource-copy .resource-unit { font-size: 13px; font-weight: 500; }
.resource-copy > .capacity-value { font-size: 18px; }
.capacity-value em { font-style: normal; color: var(--metric-color); transition: color .3s; }
.resource-card.normal .capacity-value em { color: var(--monitor-green-text); }
.resource-card.elevated, .disk-usage.elevated, .trends-panel.elevated { --metric-color: var(--monitor-warning); }
.resource-card.high, .disk-usage.high, .trends-panel.high { --metric-color: var(--monitor-danger); }
.resource-card.unavailable, .disk-usage.unavailable, .trends-panel.unavailable { --metric-color: var(--muted); }
.resource-card.elevated .resource-copy > small, .resource-card.high .resource-copy > small { color: var(--metric-color); }
.trends-panel { --chart-color: var(--metric-color); }
.trends-panel .trend-summary strong { color: var(--metric-color); }
.trends-panel .network-label i { background: var(--metric-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--metric-color) 12%, transparent); }
.capacity-value span { font-size: 12px; color: var(--subtle); font-weight: 400; letter-spacing: -.2px; }
.system-overview, .metric-panel, .disk-section { border: 1px solid var(--monitor-border); border-radius: 12px; background: var(--surface); box-shadow: var(--monitor-shadow); }
.system-overview { margin-top: 16px; padding: 18px 22px; background: color-mix(in srgb, var(--surface) 65%, transparent); box-shadow: none; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 24px; }
.section-heading > span { color: var(--muted); font-size: 11px; }
dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
dl > div { min-width: 0; padding: 0 22px; border-left: 1px solid var(--monitor-border); }
dl > div:first-child { padding-left: 0; border-left: 0; }
dt { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; line-height: 18px; }
dt small { font-size: 10px; margin-left: 4px; }
dd { margin: 8px 0 0; font-size: 15px; line-height: 22px; font-weight: 500; overflow-wrap: anywhere; }
.monitor-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
.metric-panel { padding: 20px 22px 18px; min-width: 0; }
.network-panel { --chart-color: var(--monitor-amber); --chart-secondary: var(--monitor-green); }
.active-heading { position: relative; }
.active-heading::after { content: ''; position: absolute; bottom: -9px; left: 0; width: 24px; height: 3px; border-radius: 2px; background: var(--accent); }
.network-numbers { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0 22px; }
.network-numbers > div { min-width: 0; }
.network-numbers > div + div { padding-left: 22px; border-left: 1px solid var(--monitor-border); }
.network-numbers strong { display: block; margin-top: 7px; font-size: 24px; line-height: 30px; font-weight: 550; white-space: nowrap; letter-spacing: -.5px; }
.readings-stale .network-numbers strong { color: var(--muted); }
.network-label { font-size: 12px; line-height: 18px; color: var(--subtle); display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.network-label i { width: 6px; height: 6px; border-radius: 50%; background: var(--monitor-amber); box-shadow: 0 0 0 3px color-mix(in srgb, var(--monitor-amber) 12%, transparent); margin-right: 3px; }
.network-label.transmit i { background: var(--monitor-green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--monitor-green) 12%, transparent); }
.trend-tabs { display: flex; align-items: center; align-self: stretch; gap: 24px; }
.trend-tabs button { padding: 0; position: relative; font-size: 14px; font-weight: 500; color: var(--muted); transition: color .18s; }
.trend-tabs button.active { color: var(--ink); font-weight: 600; }
.trend-tabs button.active::after { content: ''; position: absolute; bottom: -9px; left: 0; width: 24px; height: 3px; border-radius: 2px; background: var(--accent); }
.trend-tabs button:hover { color: var(--accent); }
.trend-summary { margin: 24px 0 22px; }
.trend-summary strong { display: block; margin-top: 7px; font-size: 24px; line-height: 30px; font-weight: 550; letter-spacing: -.5px; }
.disk-section { margin-top: 16px; overflow: hidden; }
.disk-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 22px; }
.panel-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.disk-count { font-size: 11px; color: var(--muted); font-weight: 400; white-space: nowrap; }
.disk-warning { display: inline-flex; align-items: center; gap: 5px; color: var(--warning); font-size: 11px; }
.disk-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; text-align: left; font-size: 12px; table-layout: fixed; min-width: 600px; }
th { padding: 10px 22px; background: var(--raised); font-size: 11px; line-height: 18px; font-weight: 400; color: var(--subtle); }
th:first-child { width: 28%; } th:nth-child(2) { width: 26%; } th:nth-child(3) { width: 18%; } th:last-child { width: 28%; }
td { padding: 14px 22px; border-top: 1px solid var(--monitor-border); }
tbody tr { transition: background .18s; }
tbody tr:hover { background: var(--raised); }
td strong, td small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
td strong { font-weight: 500; line-height: 20px; } td small { color: var(--muted); font-size: 10px; line-height: 16px; }
.disk-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.disk-identity > div { min-width: 0; }
.disk-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; background: var(--raised); color: var(--subtle); border-radius: 8px; flex-shrink: 0; }
.disk-usage { display: flex; gap: 14px; align-items: center; }
.disk-usage > span { width: 44px; flex-shrink: 0; text-align: right; font-size: 12px; }
.disk-track { height: 6px; background: var(--gauge-track); border-radius: 3px; flex: 1; overflow: hidden; }
.disk-track i { display: block; height: 100%; border-radius: inherit; background: var(--metric-color); }
.disk-usage > span { color: var(--metric-color); }
.monitor-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); font-size: 11px; margin-top: 16px; line-height: 18px; }
.monitor-footer > span { display: inline-flex; align-items: center; gap: 5px; }
.monitor-notice { padding: 11px 14px; margin-bottom: 16px; font-size: 12px; line-height: 1.6; color: var(--subtle); border: 1px solid var(--monitor-border); border-radius: 8px; background: var(--surface); }
.monitor-error { color: var(--danger); border-color: var(--danger-line); background: var(--danger-soft); }
.monitor-warning { color: var(--warning); font-size: 12px; margin-top: 12px; }
.monitor-loading, .monitor-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 340px; gap: 14px; color: var(--subtle); }
.monitor-loading h2, .monitor-empty h2 { font-size: 15px; color: var(--ink); }
.monitor-loading p, .monitor-empty p { font-size: 12px; }
.loading-bars { display: flex; gap: 14px; width: min(100%, 480px); margin-top: 15px; }
.loading-bars span { flex: 1; height: 100px; background: var(--surface); border: 1px solid var(--monitor-border); border-radius: 12px; animation: loading-pulse 1.5s ease-in-out infinite alternate; }
.loading-bars span:nth-child(2) { animation-delay: .15s; } .loading-bars span:nth-child(3) { animation-delay: .3s; }
@keyframes loading-pulse { to { opacity: .4; } }
.no-disks { padding: 16px 22px; color: var(--subtle); font-size: 12px; }
@media (max-width: 1100px) {
  .monitor-inner { padding: 16px 20px 24px; }
  .resource-overview { grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr); gap: 12px; }
  .load-card { padding: 20px; }
  .load-card :deep(.resource-gauge) { width: 120px; height: 120px; right: 8px; top: 48px; }
  .load-copy > strong { font-size: 30px; }
  .load-footnote { left: 20px; right: 20px; font-size: 10px; }
  .resource-copy > .capacity-value { font-size: 16px; }
  .capacity-value span { font-size: 11px; }
  dl > div { padding: 0 16px; }
  dd { font-size: 13px; }
  .metric-panel { padding: 18px; }
}
@media (max-width: 850px) {
  .resource-overview { grid-template-columns: minmax(0, 1fr); }
  .load-card { height: 190px; }
  .load-copy { margin-top: 10px; }
  .load-copy > .load-status { margin-top: 4px; }
  .load-card :deep(.resource-gauge) { width: 132px; height: 132px; top: 8px; right: 20px; }
  .load-footnote { display: flex; bottom: 12px; padding-top: 0; border-top: 0; }
  .resource-metrics { height: 240px; }
  dl { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 22px; }
  dl > div:nth-child(3) { padding-left: 0; border-left: 0; }
  .monitor-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 500px) {
  .monitor-inner { padding: 14px 14px 20px; }
  .monitor-controls :deep(.arco-btn) { padding: 0 8px; }
  .resource-metrics { height: auto; grid-template-columns: minmax(0, 1fr); padding: 0 16px; }
  .resource-card { display: grid; grid-template-columns: minmax(0, 1fr) 112px; grid-template-rows: 20px auto; text-align: left; padding: 16px 0; border-left: 0; border-top: 1px solid var(--monitor-border); }
  .resource-card:first-child { border-top: 0; }
  .resource-card :deep(.resource-gauge) { grid-column: 2; grid-row: 1 / 3; width: 112px; height: 112px; margin: 0; }
  .resource-label { align-self: start; }
  .resource-copy { align-self: center; margin: 0; }
  .resource-copy > strong { font-size: 22px; }
  .resource-copy > .capacity-value { font-size: 19px; }
  .capacity-value span { font-size: 12px; }
  .resource-copy > small { font-size: 11px; }
  .network-numbers strong { font-size: 22px; }
  .system-overview { padding: 16px; }
  .disk-heading { align-items: flex-start; flex-wrap: wrap; padding: 16px; }
}
@media (max-height: 850px) and (min-width: 851px) {
  .load-card, .resource-metrics { height: 220px; }
  .resource-metrics { padding: 14px 0; }
  .resource-card :deep(.resource-gauge) { width: 116px; height: 116px; margin-top: 5px; }
  .resource-card :deep(.gauge-value) { font-size: 27px; }
  .load-card :deep(.resource-gauge) { top: 33px; }
  .load-copy { margin-top: 22px; }
  .load-footnote { bottom: 16px; padding-top: 12px; }
  .monitor-grid, .system-overview { margin-top: 14px; }
  .network-numbers, .trend-summary { margin-top: 20px; margin-bottom: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .load-dot::after { animation: none !important; }
  .pulse-light { animation: none !important; stroke-dasharray: none; }
  .capacity-value em { transition: none; }
  .loading-bars span { animation: none; }
}
</style>
