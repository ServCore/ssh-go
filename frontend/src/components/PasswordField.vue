<script setup lang="ts">
import { ref, useId } from "vue";
import AppIcon from "./AppIcon.vue";
defineProps<{ label: string; placeholder?: string; disabled?: boolean }>();
const model = defineModel<string>({ default: "" });
const visible = ref(false),
  id = useId();
</script>
<template>
  <div class="form-field">
    <label :for="id">{{ label }}</label>
    <div class="password-field">
      <input
        :id="id"
        v-model="model"
        :type="visible ? 'text' : 'password'"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
      /><button
        type="button"
        class="icon-button"
        :aria-label="visible ? '隐藏密码' : '显示密码'"
        @click="visible = !visible"
      >
        <AppIcon :name="visible ? 'hidden' : 'eye'" :size="16" />
      </button>
    </div>
  </div>
</template>
