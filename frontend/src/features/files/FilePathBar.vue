<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppIcon from "../../components/AppIcon.vue";
const props = defineProps<{
  modelValue: string;
  path: string;
  title: string;
  disabled?: boolean;
  loading: boolean;
  navigationError: string;
  visible: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string]; navigate: [path: string]; edit: [] }>();
const root = ref<HTMLElement>(), input = ref<HTMLInputElement>(), breadcrumbs = ref<HTMLElement>();
const editing = ref(false);
let awaitingNavigation = false;
const segments = computed(() => {
  const absolute = props.path.startsWith("/");
  const result = absolute ? [{ name: "/", path: "/" }] : [];
  let prefix = "";
  for (const name of props.path.split("/").filter(Boolean)) {
    prefix = absolute || prefix ? `${prefix}/${name}` : name;
    result.push({ name, path: prefix });
  }
  return result;
});
async function revealCurrent() {
  await nextTick();
  if (breadcrumbs.value) breadcrumbs.value.scrollLeft = breadcrumbs.value.scrollWidth;
}
async function beginEdit() {
  if (props.disabled || editing.value) return;
  emit("edit");
  emit("update:modelValue", props.path);
  editing.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}
function cancelEdit() {
  awaitingNavigation = false;
  editing.value = false;
  emit("update:modelValue", props.path);
}
function submit() {
  if (props.disabled) return;
  const target = (editing.value ? props.modelValue : props.path).trim();
  if (!target) return;
  awaitingNavigation = true;
  emit("navigate", target);
}
function choose(target: string) {
  if (props.disabled || props.loading || target === props.path) return;
  awaitingNavigation = true;
  emit("navigate", target);
}
function doubleClick(event: MouseEvent) {
  if (!editing.value && !(event.target as Element).closest("button")) {
    event.preventDefault();
    void beginEdit();
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape" && editing.value) { event.preventDefault(); cancelEdit(); return; }
  if (event.key === "Enter" && event.target === input.value) {
    event.preventDefault();
    if (editing.value) submit();
    else void beginEdit();
    return;
  }
  if (!editing.value && (event.key === "F2" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l"))) {
    event.preventDefault(); void beginEdit(); return;
  }
  if (!editing.value && (event.target as HTMLElement).closest(".file-path-segment") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const buttons = [...(breadcrumbs.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
    buttons[next]?.focus();
  }
}
function blur(event: FocusEvent) {
  // Clicking the adjacent Go button submits the draft rather than cancelling it.
  if (editing.value && !root.value?.parentElement?.contains(event.relatedTarget as Node | null) && !awaitingNavigation) cancelEdit();
}
watch(() => props.loading, loading => {
  if (!loading && awaitingNavigation) {
    awaitingNavigation = false;
    if (!props.navigationError) editing.value = false;
  }
});
watch(() => [props.visible, props.disabled], () => {
  if (!props.visible || props.disabled) cancelEdit();
});
watch([() => props.path, editing], revealCurrent);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => { void revealCurrent(); });
  if (root.value) observer.observe(root.value);
  void revealCurrent();
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ submit });
</script>
<template>
  <div ref="root" class="file-path-control" :class="{ 'is-editing': editing }" @dblclick="doubleClick" @keydown="keydown">
    <input ref="input" :value="editing ? modelValue : path" :readonly="!editing" :aria-label="`${title}目录路径`" :disabled="disabled"
      :title="editing ? 'Enter 前往目录 · Esc 取消编辑' : `${path}\n点击目录名称直接跳转 · 双击空白处或按 F2 编辑路径`" spellcheck="false"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @blur="blur" />
    <nav v-if="!editing" class="file-path-breadcrumbs" :aria-label="`${title}路径分段`" @dblclick.stop>
      <div ref="breadcrumbs" class="file-path-segments">
        <template v-for="(segment, index) in segments" :key="segment.path">
          <AppIcon v-if="index" class="file-path-separator" name="right" :size="11" />
          <button type="button" class="file-path-segment" :aria-label="`转到 ${segment.path}`" :aria-current="segment.path === path ? 'location' : undefined" :title="segment.path" :disabled="disabled || loading" @click="choose(segment.path)">{{ segment.name }}</button>
        </template>
      </div>
    </nav>
    <AppIcon class="file-path-affordance" name="edit" :size="12" />
  </div>
</template>
<style scoped>
.file-path-control { flex: 1; min-width: 0; position: relative; }
.file-path-control > input { width: 100%; height: 29px; min-width: 0; padding: 0 25px 0 7px; border-color: var(--line); font: 11px Menlo, Monaco, monospace; cursor: default; }
.file-path-control:not(.is-editing) > input { color: transparent; caret-color: transparent; user-select: none; }
.file-path-control.is-editing > input { cursor: text; }
.file-path-breadcrumbs { position: absolute; left: 4px; right: 32px; top: 1px; bottom: 1px; display: flex; align-items: center; pointer-events: none; }
.file-path-segments { display: flex; align-items: center; gap: 2px; min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; pointer-events: auto; }
.file-path-segments::-webkit-scrollbar { display: none; }
.file-path-segment { flex-shrink: 0; max-width: 180px; height: 24px; padding: 0 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 3px; color: var(--subtle); font-size: 11px; }
.file-path-segment[aria-current="location"] { color: var(--ink); }
.file-path-segment:hover:not(:disabled), .file-path-segment:focus-visible { background: var(--accent-soft); color: var(--accent); }
.file-path-segment:disabled { color: var(--muted); cursor: default; }
.file-path-separator { --icon-color: var(--muted); flex-shrink: 0; }
.file-path-affordance { --icon-color: var(--muted); position: absolute; top: 8px; right: 8px; pointer-events: none; }
</style>
