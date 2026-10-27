<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { listTransferRecoveries, recoverTransfer } from "../../lib/api";
import type { TransferRecoveryInfo } from "../../lib/types";
import { useWorkspace } from "../../composables/workspace";
import { errorMessage } from "../../lib/format";
import BaseModal from "../../components/BaseModal.vue";
import AppIcon from "../../components/AppIcon.vue";
const w = useWorkspace(),
  records = ref<TransferRecoveryInfo[]>([]),
  busy = ref(false),
  error = ref(""),
  message = ref(""),
  loaded = ref(false),
  choice = ref<{
    record: TransferRecoveryInfo;
    action: "restore" | "discard";
  } | null>(null);
let alive = true;
const phases: Record<string, string> = {
  prepared: "准备传输",
  copying: "写入临时文件",
  staged: "临时文件就绪",
  backupPending: "准备备份原文件",
  backupCreated: "原文件已备份",
  commitPending: "准备替换目标文件",
  committed: "目标文件已写入",
};
function session(record: TransferRecoveryInfo) {
  return w.sessions.value.find((s) => s.hostId === record.hostId && !s.closed);
}
async function refresh() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const items = await listTransferRecoveries();
    if (alive) {
      records.value = items.slice(0, 200);
      loaded.value = true;
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function confirm() {
  if (!choice.value || busy.value) return;
  const snapshot = choice.value,
    current = session(snapshot.record);
  if (snapshot.record.hostId && !current) {
    error.value = "请先重新连接对应服务器，再处理远端临时文件。";
    return;
  }
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await recoverTransfer(snapshot.record.id, snapshot.action, current?.id);
    const next = await listTransferRecoveries();
    if (alive) {
      records.value = next.slice(0, 200);
      choice.value = null;
      message.value =
        snapshot.action === "restore"
          ? "原文件备份已恢复；传输不会自动继续。"
          : "本次传输的临时文件已清理；原文件与原文件备份保留。";
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
onMounted(refresh);
onBeforeUnmount(() => {
  alive = false;
});
</script>
<template>
  <section class="transfer-recovery-panel" aria-label="中断传输处理">
    <div class="recovery-heading">
      <h3><AppIcon name="safe" :size="17" />中断传输处理</h3>
      <a-button type="text" size="small" :disabled="busy" @click="refresh"
        >刷新中断记录</a-button
      >
    </div>
    <p class="form-note">
      检查中断留下的临时文件与备份，不会自动续传或重新上传。
    </p>
    <p v-if="error && !choice" class="inline-error" role="alert">{{ error }}</p>
    <p v-if="message" class="success-notice" role="status">{{ message }}</p>
    <p v-if="!loaded && busy" role="status" class="form-note">
      正在读取中断记录…
    </p>
    <p v-if="loaded && !records.length" class="settings-empty">
      没有待处理的中断传输。
    </p>
    <ul class="recovery-list">
      <li v-for="r in records" :key="r.id" :aria-label="`中断传输 ${r.name}`">
        <div class="recovery-record-title">
          <strong>{{ r.name }}</strong
          ><span>{{ phases[r.phase] || r.phase }}</span>
        </div>
        <dl>
          <dt>位置</dt>
          <dd>
            {{
              r.hostId ? `远端 · ${session(r)?.hostName || r.hostId}` : "本地"
            }}
          </dd>
          <dt>目标文件</dt>
          <dd>{{ r.finalPath }}</dd>
          <dt>临时文件</dt>
          <dd>{{ r.stagingPath }}</dd>
          <template v-if="r.backupPath"
            ><dt>原文件备份</dt>
            <dd>{{ r.backupPath }}</dd></template
          >
        </dl>
        <p v-if="r.hostId && !session(r)" class="form-note">
          请先重新连接对应服务器，再处理远端文件。
        </p>
        <p v-if="!r.backupPath" class="form-note">
          此记录没有原文件备份，可清理本次传输的临时文件。
        </p>
        <div class="recovery-record-actions">
          <a-button
            size="small"
            :disabled="
              busy || !r.backupPath || Boolean(r.hostId && !session(r))
            "
            @click="
              choice = { record: r, action: 'restore' };
              error = '';
            "
            >恢复原文件</a-button
          ><a-button
            size="small"
            :disabled="busy || Boolean(r.hostId && !session(r))"
            @click="
              choice = { record: r, action: 'discard' };
              error = '';
            "
            >清理临时文件</a-button
          >
        </div>
      </li>
    </ul>
    <BaseModal
      v-if="choice"
      :title="
        choice.action === 'restore' ? '确认恢复原文件' : '确认清理临时文件'
      "
      :description="
        choice.action === 'restore'
          ? '仅在目标文件不存在时将备份移回原路径。如果目标已存在，会保留文件并显示错误。'
          : '仅清理本次传输产生的 .part 临时文件，保留原文件及原文件备份。'
      "
      :busy="busy"
      @close="
        choice = null;
        error = '';
      "
      ><dl class="recovery-review">
        <dt>目标文件</dt>
        <dd>{{ choice.record.finalPath }}</dd>
        <dt>临时文件</dt>
        <dd>{{ choice.record.stagingPath }}</dd>
        <template v-if="choice.record.backupPath"
          ><dt>原文件备份</dt>
          <dd>{{ choice.record.backupPath }}</dd></template
        >
      </dl>
      <p
        v-if="choice.record.hostId && !session(choice.record)"
        class="inline-error"
        role="alert"
      >
        对应 SSH 连接已断开，请先重新连接服务器。
      </p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <div class="modal-actions">
        <a-button
          :disabled="busy"
          @click="
            choice = null;
            error = '';
          "
          >取消</a-button
        ><a-button
          type="primary"
          :loading="busy"
          :disabled="Boolean(choice.record.hostId && !session(choice.record))"
          @click="confirm"
          >{{
            choice.action === "restore" ? "确认恢复原文件" : "确认清理临时文件"
          }}</a-button
        >
      </div></BaseModal
    >
  </section>
</template>
