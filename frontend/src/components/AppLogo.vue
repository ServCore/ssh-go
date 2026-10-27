<script setup lang="ts">
import mark from "../assets/brand/app-mark.svg?raw";
</script>

<template>
  <span class="app-logo" aria-hidden="true" v-html="mark"></span>
</template>

<style scoped>
.app-logo { display: inline-flex; width: 28px; height: 28px; flex: 0 0 28px; }
.app-logo :deep(svg) { display: block; width: 100%; height: 100%; color: var(--accent-solid); }
</style>
