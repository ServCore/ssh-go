<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, useId, watch } from "vue";
import BaseModal from "../../components/BaseModal.vue";
import PasswordField from "../../components/PasswordField.vue";
import AppIcon from "../../components/AppIcon.vue";
import { chooseSshPrivateKey, getHostPassword, saveHost } from "../../lib/api";
import type { HostConfig } from "../../lib/types";
import { errorMessage } from "../../lib/format";
const props = defineProps<{
  host?: HostConfig;
  hosts: HostConfig[];
  visible?: boolean;
  onSaved: (hostId: string, creating: boolean) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const groupsId = useId();
const form = reactive<HostConfig>(
  props.host
    ? {
        ...JSON.parse(JSON.stringify(props.host)),
        authMethod: props.host.authMethod || "password",
        jumpHostId: props.host.jumpHostId || null,
      }
    : {
        id: crypto.randomUUID(),
        name: "",
        address: "",
        port: 22,
        username: "",
        group: "",
        rememberPassword: false,
        authMethod: "password",
        privateKeyPath: null,
        jumpHostId: null,
      },
);
const password = ref(""),
  loadingPassword = ref(false),
  error = ref(""),
  notice = ref(""),
  saving = ref(false);
let passwordRequest = 0;
watch(form, () => { notice.value = ""; });
watch(
  () => form.authMethod,
  async () => {
    const request = ++passwordRequest;
    password.value = "";
    loadingPassword.value = false;
    if (form.authMethod !== "privateKey") form.privateKeyPath = null;
    if (
      !props.host?.rememberPassword ||
      form.authMethod === "agent" ||
      form.authMethod !== (props.host.authMethod || "password")
    ) return;
    loadingPassword.value = true;
    try {
      const saved = await getHostPassword(props.host.id);
      if (request === passwordRequest) password.value = saved;
    } catch (e) {
      if (request === passwordRequest) error.value = errorMessage(e);
    } finally {
      if (request === passwordRequest) loadingPassword.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  passwordRequest++;
  password.value = "";
});
async function chooseKey() {
  try {
    const path = await chooseSshPrivateKey();
    if (path) form.privateKeyPath = path;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function save() {
  if (saving.value || loadingPassword.value) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await saveHost(
      {
        ...form,
        name: form.name.trim(),
        address: form.address.trim(),
        username: form.username.trim(),
        group: form.group.trim(),
        authMethod: form.authMethod || "password",
        privateKeyPath:
          form.authMethod === "privateKey"
            ? form.privateKeyPath?.trim() || null
            : null,
      },
      form.authMethod === "agent" ? undefined : password.value || undefined,
    );
    if (!props.host) password.value = "";
    // Saving can finish after the user selects another host and this editor unmounts.
    await props.onSaved(form.id, !props.host);
    notice.value = "连接设置已保存";
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <component
    :is="host ? 'div' : BaseModal"
    :class="{ 'host-settings-content': host }"
    v-bind="host ? {} : { title: '添加服务器', description: '保存连接信息，下次即可快速打开终端与文件。', busy: saving, width: 560 }"
    @close="emit('close')"
  >
    <header v-if="host" class="host-settings-heading">
      <h1>{{ host.name }} · 连接设置</h1>
      <p>管理服务器地址、登录凭据和连接方式。</p>
    </header>
    <form class="host-editor form-stack" @submit.prevent="save">
      <div class="host-editor-fields">
      <label class="form-field"
        >服务器名称<input
          v-model="form.name"
          required
          maxlength="120"
          placeholder="例如：开发服务器"
          autofocus
      /></label>
      <div class="form-grid address-grid">
        <label class="form-field"
          >主机地址<input
            v-model="form.address"
            required
            placeholder="IP 地址或域名"
            spellcheck="false" /></label
        ><label class="form-field"
          >端口<input
            v-model.number="form.port"
            required
            type="number"
            min="1"
            max="65535"
        /></label>
      </div>
      <div class="form-grid">
        <label class="form-field"
          >用户名<input
            v-model="form.username"
            required
            placeholder="例如：root"
            autocomplete="username" /></label
        ><label class="form-field"
          >分组<input
            v-model="form.group"
            maxlength="80"
            placeholder="可选，例如：生产环境"
            :list="groupsId"
          /><datalist :id="groupsId">
            <option
              v-for="g in [
                ...new Set(hosts.map((h) => h.group).filter(Boolean)),
              ]"
              :key="g"
            >
              {{ g }}
            </option>
          </datalist></label
        >
      </div>
      <label class="form-field"
        >认证方式<select v-model="form.authMethod">
          <option value="password">账号密码</option>
          <option value="privateKey">SSH 私钥</option>
          <option value="agent">SSH Agent</option>
        </select></label
      >
      <template v-if="form.authMethod === 'privateKey'"
        ><label class="form-field"
          >私钥文件
          <div class="input-action">
            <input
              v-model="form.privateKeyPath"
              required
              placeholder="/Users/me/.ssh/id_ed25519"
            /><a-button @click="chooseKey">选择私钥文件</a-button>
          </div></label
        >
        <p class="form-note">
          只保存私钥路径，私钥文件保留在原位置。
        </p></template
      >
      <PasswordField
        v-if="form.authMethod !== 'agent'"
        :key="`${form.authMethod}-${visible !== false}`"
        v-model="password"
        :disabled="loadingPassword"
        :label="form.authMethod === 'privateKey' ? '私钥口令' : '密码'"
        :placeholder="
          loadingPassword ? '正在读取已保存凭据…' : '可在连接时输入'
        "
      />
      <p v-else class="form-note">
        使用本机 SSH Agent 中已加载的密钥，请先通过 ssh-add 加载密钥。
      </p>
      <label class="form-field"
        >跳板机<select v-model="form.jumpHostId">
          <option :value="null">直接连接</option>
          <option
            v-for="h in hosts.filter((h) => h.id !== form.id)"
            :key="h.id"
            :value="h.id"
          >
            {{ h.name }} · {{ h.address }}:{{ h.port }}
          </option>
        </select></label
      >
      <div class="security-note">
        <AppIcon name="lock" :size="16" /><span
          >凭据加密保存在本机。首次连接时需确认服务器指纹。</span
        >
      </div>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <p v-if="notice && host" class="form-note" role="status">{{ notice }}</p>
      </div>
      <div class="modal-actions">
        <a-button :disabled="saving" @click="emit('close')">{{ host ? '关闭标签页' : '取消' }}</a-button
        ><a-button type="primary" html-type="submit" :loading="saving" :disabled="loadingPassword"
          >保存服务器</a-button
        >
      </div>
    </form>
  </component>
</template>
