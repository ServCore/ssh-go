<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { HostConfig } from "../../lib/types";
import BaseModal from "../../components/BaseModal.vue";
import PasswordField from "../../components/PasswordField.vue";
defineProps<{ host: HostConfig }>();
const emit = defineEmits<{ close: []; submit: [secret: string] }>();
const secret = ref("");
function submit() {
  const value = secret.value;
  secret.value = "";
  emit("submit", value);
}
onBeforeUnmount(() => {
  secret.value = "";
});
</script>
<template>
  <BaseModal
    :title="`连接 ${host.name}`"
    :description="`${host.username}@${host.address}:${host.port}`"
    :width="440"
    @close="emit('close')"
    ><form class="form-stack" @submit.prevent="submit">
      <PasswordField
        v-model="secret"
        :label="host.authMethod === 'privateKey' ? '私钥口令' : '密码'"
        placeholder="输入服务器凭据"
      />
      <p class="form-note">验证成功后加密保存，之后可以直接连接。</p>
      <div class="modal-actions">
        <a-button @click="emit('close')">取消</a-button
        ><a-button type="primary" html-type="submit">连接</a-button>
      </div>
    </form></BaseModal
  >
</template>
