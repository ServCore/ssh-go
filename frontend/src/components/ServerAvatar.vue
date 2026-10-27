<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { hostSystemIdentity } from "../lib/hostSystem";
import type { RemoteSystem } from "../lib/types";
const props = defineProps<{ system?: RemoteSystem | null; large?: boolean }>();
const identity = computed(() => hostSystemIdentity(props.system));
</script>
<template>
  <span class="server-avatar" :class="{ large }" :style="identity.color ? { '--server-icon-bg': identity.color } : undefined" :data-system="identity.kind" :title="identity.label">
    <!-- SVG markup comes only from bundled, trusted assets; remote values are labels. -->
    <span v-if="identity.icon" class="system-icon" role="img" :aria-label="identity.label" v-html="identity.icon"></span>
    <AppIcon v-else name="server" :size="large ? 28 : 24" />
    <slot />
  </span>
</template>
<style scoped>
.system-icon { display: block; width: 25px; height: 25px; }
.system-icon :deep(svg) { display: block; width: 100%; height: 100%; fill: currentColor; }
.large .system-icon { width: 30px; height: 30px; }
</style>
