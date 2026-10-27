<script setup lang="ts">
import { computed, ref } from "vue";
import BaseModal from "../../components/BaseModal.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useWorkspace } from "../../composables/workspace";
const w = useWorkspace(),
  query = ref(""),
  index = ref(0);
const emit = defineEmits<{ close: [] }>();
const items = computed(() =>
  [
    ...w.hosts.value.map((h) => ({
      id: h.id,
      name: h.name,
      detail: `${h.username}@${h.address}:${h.port}`,
      kind: "server" as const,
      run: () => void w.connect(h),
    })),
    ...(w.active.value && !w.active.value.closed ? [{
      id: "forwards",
      name: "端口转发",
      detail: `管理 ${w.active.value.hostName} 的本地端口映射`,
      kind: "swap" as const,
      run: () => { w.forwardID.value = w.active.value?.id ?? null; },
    }] : []),
    {
      id: "new",
      name: "添加服务器",
      detail: "创建新的 SSH 连接",
      kind: "plus" as const,
      run: () => {
        w.editor.value = "new";
      },
    },
    {
      id: "settings",
      name: "打开设置",
      detail: "配置、数据和服务器信任",
      kind: "settings" as const,
      run: w.showSettings,
    },
    {
      id: "transfers",
      name: "查看传输队列",
      detail: "传输进度与中断处理",
      kind: "swap" as const,
      run: () => {
        w.transfersOpen.value = true;
      },
    },
  ].filter((i) =>
    (i.name + " " + i.detail)
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase()),
  ),
);
function choose(i: number) {
  const item = items.value[i];
  if (!item) return;
  emit("close");
  item.run();
}
function keydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    index.value = (index.value + 1) % Math.max(1, items.value.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    index.value =
      (index.value - 1 + items.value.length) % Math.max(1, items.value.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    choose(index.value);
  }
}
</script>
<template>
  <BaseModal title="搜索资源与操作" :width="580" @close="emit('close')"
    ><div class="palette-search">
      <AppIcon name="search" :size="20" /><input
        v-model="query"
        autofocus
        placeholder="搜索服务器、设置或操作"
        aria-label="搜索资源"
        @input="index = 0"
        @keydown="keydown"
      /><kbd>ESC</kbd>
    </div>
    <div class="palette-results">
      <button
        v-for="(item, i) in items"
        :key="item.id"
        :class="{ active: i === index }"
        @click="choose(i)"
        @pointermove="index = i"
      >
        <span class="palette-icon"
          ><AppIcon :name="item.kind" :size="18" /></span
        ><span
          ><strong>{{ item.name }}</strong
          ><small>{{ item.detail }}</small></span
        ><AppIcon name="right" :size="15" />
      </button>
      <p v-if="!items.length" class="settings-empty">没有找到匹配的资源。</p>
    </div>
    <div class="palette-hint">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span>
    </div></BaseModal
  >
</template>
