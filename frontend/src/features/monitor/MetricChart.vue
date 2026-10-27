<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { formatBytes } from "../../lib/format";
export interface ChartPoint { at: number; value: number | null }
const props = defineProps<{
  label: string;
  points: ChartPoint[];
  secondary?: ChartPoint[];
  end: number;
  maximum?: number;
  primaryName?: string;
  secondaryName?: string;
}>();
const hoverAt = ref<number | null>(null);
const clipId = `chart-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
const scale = computed(() => props.maximum ?? Math.max(1024, ...props.points.map(p => p.value ?? 0), ...(props.secondary ?? []).map(p => p.value ?? 0)) * 1.15);
function coordinates(point: ChartPoint) {
  return {
    x: 8 + Math.max(0, Math.min(1, (point.at - (props.end - 300000)) / 300000)) * 584,
    y: 148 - Math.max(0, Math.min(1, (point.value ?? 0) / scale.value)) * 140,
  };
}
function segments(points: ChartPoint[]) {
  const result: ChartPoint[][] = [];
  let segment: ChartPoint[] = [];
  for (const point of points) {
    if (point.value === null) { segment = []; continue; }
    const previous = segment[segment.length - 1];
    if (!previous || point.at - previous.at > 15000) { segment = []; result.push(segment); }
    segment.push(point);
  }
  return result;
}
function path(points: ChartPoint[], area = false) {
  return segments(points).map(segment => {
    const line = segment.map((point, i) => {
      const p = coordinates(point);
      return `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }).join(" ");
    if (!area || segment.length < 2) return area ? "" : line;
    return `${line} L${coordinates(segment[segment.length - 1]!).x.toFixed(2)},148 L${coordinates(segment[0]!).x.toFixed(2)},148 Z`;
  }).join(" ");
}
function readingValue(value: number) { return props.maximum ? `${value.toFixed(1)}%` : `${formatBytes(Math.round(value))}/s`; }
function tick(value: number) { return props.maximum ? `${Math.round(value)}%` : `${formatBytes(Math.round(value))}/s`; }
const primaryPath = computed(() => path(props.points));
const areaPath = computed(() => path(props.points, true));
const secondaryPath = computed(() => path(props.secondary ?? []));
const secondaryArea = computed(() => path(props.secondary ?? [], true));
const timestamps = computed(() => [...new Set([...props.points, ...(props.secondary ?? [])].map(p => p.at))].sort((a, b) => a - b));
const selected = computed(() => hoverAt.value === null ? null : timestamps.value.reduce<number | null>((nearest, at) => nearest === null || Math.abs(at - hoverAt.value!) < Math.abs(nearest - hoverAt.value!) ? at : nearest, null));
const hoverX = computed(() => selected.value === null ? 0 : coordinates({ at: selected.value, value: 0 }).x);
const readings = computed(() => [
  { name: props.primaryName ?? '使用率', value: props.points.find(p => p.at === selected.value)?.value, secondary: false },
  ...(props.secondary ? [{ name: props.secondaryName ?? '发送', value: props.secondary.find(p => p.at === selected.value)?.value, secondary: true }] : []),
]);
function time(at: number) { return new Date(at).toLocaleTimeString('zh-CN', { hour12: false }); }
function inspect(event: PointerEvent) {
  const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
  hoverAt.value = props.end - 300000 + Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 600 - 8) / 584)) * 300000;
}
function navigate(event: KeyboardEvent) {
  if (event.key === 'Escape') { hoverAt.value = null; return; }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const times = timestamps.value;
  const index = times.indexOf(selected.value ?? props.end);
  hoverAt.value = times[event.key === 'Home' ? 0 : event.key === 'End' ? times.length - 1 : Math.max(0, Math.min(times.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))] ?? null;
}
</script>
<template>
  <div class="metric-chart" :class="{ 'rate-chart': !maximum }">
    <div class="chart-plot">
      <div class="chart-values" aria-hidden="true"><span v-for="ratio in [1, .75, .5, .25, 0]" :key="ratio">{{ tick(scale * ratio) }}</span></div>
      <div class="chart-canvas">
        <svg viewBox="0 0 600 156" preserveAspectRatio="none" role="img" :aria-label="label" tabindex="0"
          @pointermove="inspect" @pointerleave="hoverAt = null" @focus="hoverAt = end" @blur="hoverAt = null" @keydown="navigate">
          <defs><clipPath :id="clipId"><rect x="5" y="4" width="590" height="148" /></clipPath></defs>
          <path class="chart-grid" d="M8 8H592 M8 43H592 M8 78H592 M8 113H592 M8 148H592" />
          <g :clip-path="`url(#${clipId})`">
            <path class="chart-area" :d="areaPath" />
            <path v-if="secondary" class="chart-area secondary" :d="secondaryArea" />
            <path class="chart-line" :d="primaryPath" />
            <path v-if="secondary" class="chart-line secondary" :d="secondaryPath" />
            <template v-for="(series, index) in [points, secondary ?? []]" :key="index">
              <circle v-if="series.length && series[series.length - 1]!.value !== null"
                :cx="coordinates(series[series.length - 1]!).x" :cy="coordinates(series[series.length - 1]!).y"
                r="3" :class="{ secondary: index === 1 }"><title>{{ tick(series[series.length - 1]!.value!) }}</title></circle>
            </template>
            <path v-if="selected !== null" class="chart-cursor" :d="`M${hoverX} 8V148`" />
          </g>
        </svg>
        <div v-if="selected !== null" class="chart-tooltip" :style="{ left: `${Math.max(18, Math.min(82, hoverX / 6))}%` }" role="status">
          <time>{{ time(selected) }}</time>
          <div v-for="reading in readings" :key="reading.name"><span><i :class="{ secondary: reading.secondary }"></i>{{ reading.name }}</span><strong>{{ reading.value == null ? '等待采样' : readingValue(reading.value) }}</strong></div>
        </div>
      </div>
    </div>
    <div class="chart-axis" aria-hidden="true"><span>{{ time(end - 300000) }}</span><span>{{ time(end - 150000) }}</span><span>{{ time(end) }}</span></div>
  </div>
</template>
<style scoped>
.metric-chart { min-width: 0; }
.chart-plot { display: flex; gap: 10px; height: 142px; }
.chart-values { flex: 0 0 36px; display: flex; flex-direction: column; justify-content: space-between; padding: 2px 0; color: var(--muted); font-size: 10px; line-height: 14px; font-variant-numeric: tabular-nums; }
.chart-canvas { flex: 1; min-width: 0; position: relative; }
svg { display: block; width: 100%; height: 100%; overflow: visible; cursor: crosshair; border-radius: 3px; }
svg:focus-visible { outline-color: var(--accent); }
.chart-grid { fill: none; stroke: var(--monitor-border, var(--line)); stroke-width: 1; stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
.chart-area { fill: var(--chart-color, var(--accent)); opacity: .08; }
.chart-area.secondary { fill: var(--chart-secondary); opacity: .045; }
.chart-line { fill: none; stroke: var(--chart-color, var(--accent)); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.chart-line.secondary { stroke: var(--chart-secondary); }
circle { fill: var(--chart-color, var(--accent)); stroke: var(--surface); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
circle.secondary { fill: var(--chart-secondary); }
.chart-cursor { stroke: var(--subtle); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; opacity: .5; }
.rate-chart .chart-values { flex-basis: 66px; white-space: nowrap; }
.rate-chart .chart-axis { margin-left: 76px; }
.chart-axis { display: flex; justify-content: space-between; gap: 8px; margin: 8px 0 0 46px; color: var(--muted); font-size: 10px; line-height: 16px; font-variant-numeric: tabular-nums; }
.chart-tooltip { position: absolute; top: 0; z-index: 1; min-width: 145px; transform: translateX(-50%); padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); box-shadow: var(--popup-shadow); pointer-events: none; font-size: 11px; }
.chart-tooltip time { display: block; margin-bottom: 8px; color: var(--muted); }
.chart-tooltip > div { display: flex; align-items: center; justify-content: space-between; gap: 14px; line-height: 22px; }
.chart-tooltip span { display: inline-flex; align-items: center; gap: 6px; color: var(--subtle); }
.chart-tooltip strong { font-weight: 500; white-space: nowrap; }
.chart-tooltip i { width: 5px; height: 5px; border-radius: 50%; background: var(--chart-color); }
.chart-tooltip i.secondary { background: var(--chart-secondary); }
@media (max-height: 850px) and (min-width: 851px) { .chart-plot { height: 120px; } }
</style>
