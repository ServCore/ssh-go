<script setup lang="ts">
import { computed, useId } from "vue";
import { resourceTone, type ResourceTone } from "./health";
const props = defineProps<{ label: string; value: number | null; state?: ResourceTone; caption?: string }>();
const bounded = computed(() => Math.min(100, Math.max(0, props.value ?? 0)));
const tone = computed(() => props.state ?? resourceTone(props.value));
const gradientId = `gauge-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
</script>
<template>
  <div class="resource-gauge" :class="tone" role="img" :aria-label="`${label} ${value === null ? '等待采样' : value.toFixed(1) + '%'}`">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop class="gauge-light" offset="0%" />
          <stop class="gauge-color" offset="65%" />
          <stop class="gauge-light" offset="100%" />
        </linearGradient>
      </defs>
      <circle class="gauge-track" cx="60" cy="60" r="51" />
      <circle class="gauge-progress" cx="60" cy="60" r="51" pathLength="100" :stroke="tone === 'unavailable' ? 'currentColor' : `url(#${gradientId})`" :stroke-dasharray="`${bounded} 100`" :class="{ empty: !bounded }" />
    </svg>
    <span class="gauge-value">{{ value === null ? '—' : value.toFixed(1) }}<small v-if="value !== null">%</small></span>
    <span v-if="caption" class="gauge-caption">{{ caption }}</span>
  </div>
</template>
<style scoped>
.resource-gauge { position: relative; width: 128px; height: 128px; color: var(--monitor-green); flex-shrink: 0; }
.resource-gauge::before { content: ""; position: absolute; inset: 17%; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, currentColor var(--gauge-light-wash, 7%), transparent), transparent 72%); pointer-events: none; }
svg { position: relative; display: block; width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
circle { fill: none; stroke-width: 10; }
.gauge-track { stroke: var(--gauge-track); }
.normal .gauge-track, .elevated .gauge-track, .high .gauge-track { stroke: color-mix(in srgb, currentColor var(--gauge-track-tint, 15%), var(--surface)); }
.gauge-light { stop-color: color-mix(in srgb, currentColor calc(100% - var(--gauge-sheen, 12%)), white); }
.gauge-color { stop-color: currentColor; }
.gauge-progress { stroke-linecap: round; filter: drop-shadow(0 0 var(--gauge-glow-size, 0px) color-mix(in srgb, currentColor 34%, transparent)); transition: stroke-dasharray .8s cubic-bezier(.22, 1, .36, 1), stroke .25s; }
.gauge-progress.empty { visibility: hidden; }
.gauge-value { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; font-size: 30px; line-height: 1; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.8px; }
.gauge-value small { font-size: 14px; font-weight: 500; margin: 7px 0 0 2px; letter-spacing: 0; }
.gauge-caption { position: absolute; top: 66%; left: 0; right: 0; text-align: center; color: var(--subtle); font-size: 10px; }
.resource-gauge:has(.gauge-caption) .gauge-value { padding-bottom: 10px; }
.normal .gauge-value, .elevated .gauge-value, .high .gauge-value { text-shadow: 0 0 var(--gauge-text-glow, 0px) color-mix(in srgb, currentColor 20%, transparent); }
.elevated { color: var(--monitor-warning); } .high { color: var(--monitor-danger); } .unavailable { color: var(--muted); }
.unavailable::before { display: none; }
.unavailable .gauge-progress { filter: none; }
@media (max-width: 500px) { .gauge-value { font-size: 24px; } .gauge-value small { font-size: 11px; margin-top: 5px; } }
@media (prefers-reduced-motion: reduce) { .gauge-progress { transition: none; } }
</style>
