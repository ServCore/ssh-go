<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { listSystemFonts } from "../../lib/api";
import { defaultTerminalFont, fontFamilyCSS, setTerminalFont, terminalFont } from "../../composables/terminalFont";
import { errorMessage } from "../../lib/format";

const family = ref(terminalFont.value.family), size = ref(terminalFont.value.size);
const saving = ref(false), edited = ref(false), error = ref(""), notice = ref("");
const choicesId = useId();
const commonFonts = ["手札体-简", "Hannotate SC", "Menlo", "Monaco", "SFMono-Regular", "JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas"];
const systemFonts = ref<string[]>([]), loadingFonts = ref(true), fontsError = ref("");
const choices = computed(() => {
  const installed = new Set(systemFonts.value.map(name => name.toLowerCase()));
  const preferred = systemFonts.value.length ? commonFonts.filter(name => installed.has(name.toLowerCase())) : commonFonts;
  return [...new Set([terminalFont.value.family, ...preferred, ...systemFonts.value, "monospace"])];
});
let alive = true;
async function loadFonts() {
  loadingFonts.value = true;
  fontsError.value = "";
  try {
    const fonts = await listSystemFonts();
    if (alive) systemFonts.value = fonts.sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    if (alive) fontsError.value = "暂时无法读取系统字体，仍可手动输入名称。";
  } finally {
    if (alive) loadingFonts.value = false;
  }
}
onMounted(loadFonts);
onBeforeUnmount(() => { alive = false; });
const previewStyle = computed(() => ({ fontFamily: fontFamilyCSS(family.value), fontSize: `${Math.min(32, Math.max(8, size.value || 13))}px` }));
watch(terminalFont, (value) => {
  if (!edited.value || saving.value) {
    family.value = value.family;
    size.value = value.size;
  }
});
function edit() {
  edited.value = true;
  notice.value = "";
  error.value = "";
}
async function apply(reset = false) {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await setTerminalFont(reset ? { ...defaultTerminalFont } : { family: family.value, size: size.value });
    edited.value = false;
    notice.value = reset ? "已恢复手札体-简，字号 13。" : "字体已应用并保存。";
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <form class="terminal-font-settings" @submit.prevent="apply()">
    <div class="terminal-font-fields">
      <label class="form-field">终端字体
        <input v-model="family" :list="choicesId" required maxlength="120" placeholder="输入名称，搜索本机字体" :disabled="saving" @input="edit" />
        <datalist :id="choicesId"><option v-for="name in choices" :key="name" :value="name" /></datalist>
      </label>
      <label class="form-field">终端字号
        <input v-model.number="size" type="number" required min="8" max="32" step="1" :disabled="saving" @input="edit" />
      </label>
    </div>
    <p class="form-note" aria-label="系统字体列表状态">
      <template v-if="loadingFonts">正在读取本机字体…</template>
      <template v-else-if="fontsError">{{ fontsError }} <button type="button" class="terminal-font-retry" @click="loadFonts">重新读取字体</button></template>
      <template v-else>已读取 {{ systemFonts.length }} 种系统字体，可输入名称搜索或手动填写。字体由本机提供，无需额外下载。</template>
    </p>
    <p class="form-note">应用后立即更新所有终端；缺少字体时使用系统等宽字体。表格与代码建议使用等宽字体。</p>
    <div class="terminal-font-preview" :style="previewStyle" aria-label="终端字体预览">user@server:~/project $ ls -la<br />终端字体预览 AaBb 0123456789</div>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="form-note" role="status">{{ notice }}</p>
    <div class="terminal-font-actions">
      <a-button :disabled="saving" @click="apply(true)">恢复默认字体</a-button>
      <a-button type="primary" html-type="submit" :loading="saving">应用字体</a-button>
    </div>
  </form>
</template>
