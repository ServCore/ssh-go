<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, useId } from "vue";
import AModal from "@arco-design/web-vue/es/modal";
import "@arco-design/web-vue/es/modal/style/css.js";
import { containModalFocus } from "../composables/modalFocus";
import AppIcon from "./AppIcon.vue";
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    busy?: boolean;
    width?: number;
    closeLabel?: string;
  }>(),
  { width: 520, closeLabel: "关闭" },
);
defineEmits<{ close: [] }>();
const id = useId();
let stop: (() => void) | undefined,
  alive = true;
onMounted(async () => {
  await nextTick();
  const element = document.getElementById(id);
  if (alive && element) stop = containModalFocus(element);
});
onBeforeUnmount(() => {
  alive = false;
  stop?.();
});
</script>
<template>
  <a-modal
    :id="id"
    :visible="true"
    :width="width"
    :footer="false"
    :mask-closable="!busy"
    :esc-to-close="!busy"
    :closable="false"
    title-align="start"
    role="dialog"
    :aria-label="title"
    aria-modal="true"
    tabindex="-1"
    @cancel="$emit('close')"
  >
    <template #title
      ><div class="modal-title">
        <span>{{ title }}</span
        ><button
          type="button"
          class="icon-button"
          :aria-label="closeLabel"
          :disabled="busy"
          @click="$emit('close')"
        >
          <AppIcon name="close" :size="17" />
        </button></div
    ></template>
    <p v-if="description" class="modal-description">{{ description }}</p>
    <slot />
  </a-modal>
</template>
