<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import type { HostImportPreview, KnownHost } from "../../lib/types";
import { errorMessage } from "../../lib/format";
import { useWorkspace } from "../../composables/workspace";
import AppIcon from "../../components/AppIcon.vue";
import BaseModal from "../../components/BaseModal.vue";
import { appearanceMode, setAppearance, accentColor, setAccentColor, accentOptions, type AccentColor, type AppearanceMode } from "../../composables/appearance";
const w = useWorkspace(),
  directory = ref(""),
  known = ref<KnownHost[]>([]),
  error = ref(""),
  notice = ref(""),
  busy = ref(false),
  preview = ref<HostImportPreview | null>(null),
  forget = ref<KnownHost | null>(null);
let alive = true;
onMounted(async () => {
  try {
    const [dir, items] = await Promise.all([
      api.getDataDirectory(),
      api.listKnownHosts(),
    ]);
    if (alive) {
      directory.value = dir;
      known.value = items;
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  }
});
onBeforeUnmount(() => {
  alive = false;
});
async function chooseImport(format: "json" | "openssh") {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const path = await api.chooseHostImport(format);
    if (!path) return;
    const result = await api.previewHostImport(path, format);
    if (alive) preview.value = result;
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function importNow() {
  if (!preview.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await api.importHosts(preview.value.hosts);
    await w.reloadHosts();
    if (alive) {
      preview.value = null;
      notice.value = `已导入 ${result.imported} 台服务器${result.skipped ? `，跳过 ${result.skipped} 台重复连接` : ""}。`;
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function exportNow() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const path = await api.chooseHostExport();
    if (path) {
      await api.exportHosts(path);
      if (alive) notice.value = "连接配置已导出。";
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function forgetNow() {
  if (!forget.value || busy.value) return;
  busy.value = true;
  error.value = "";
  const snapshot = forget.value;
  try {
    await api.forgetKnownHost(
      snapshot.address,
      snapshot.port,
      snapshot.fingerprint,
    );
    const items = await api.listKnownHosts();
    if (alive) {
      known.value = items;
      forget.value = null;
      notice.value = "已移除信任，下次连接时将重新确认指纹。";
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
</script>
<template>
  <section class="settings-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">工作区偏好</div>
        <h1>设置</h1>
        <p>让连接更顺手，让数据留在本机。</p>
      </div>
    </div>
    <p v-if="error && !preview && !forget" class="inline-error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="success-notice" role="status">
      <AppIcon name="check" :size="17" />{{ notice }}
    </p>
    <div class="settings-section">
      <div class="settings-section-heading">
        <span class="settings-section-icon"
          ><AppIcon name="apps" :size="19"
        /></span>
        <div>
          <h2>外观</h2>
          <p>为工作区与终端选择舒适的配色</p>
        </div>
      </div>
      <div class="setting-row">
        <div>
          <strong>外观模式</strong>
          <p>终端与界面同步切换，跟随系统时自动调整。</p>
        </div>
        <select :value="appearanceMode" aria-label="外观模式"
          @change="setAppearance(($event.target as HTMLSelectElement).value as AppearanceMode).catch(w.fail)">
          <option value="light">亮色</option>
          <option value="dark">深色</option>
          <option value="system">跟随系统</option>
        </select>
      </div>
      <div class="setting-row">
        <div>
          <strong>主题色</strong>
          <p>操作图标、按钮和选中状态使用同一色系，状态提示保留原有颜色。</p>
        </div>
        <div class="theme-color-control">
          <span class="theme-color-preview" aria-hidden="true"></span>
          <select :value="accentColor" aria-label="主题色"
            @change="setAccentColor(($event.target as HTMLSelectElement).value as AccentColor).catch(w.fail)">
            <option v-for="option in accentOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-heading">
        <span class="settings-section-icon"
          ><AppIcon name="safe" :size="19"
        /></span>
        <div>
          <h2>连接与安全</h2>
          <p>认证与服务器身份</p>
        </div>
      </div>
      <div class="setting-row">
        <div>
          <strong>SSH 认证</strong>
          <p>支持账号密码、私钥与 SSH Agent，也可通过跳板机连接。</p>
        </div>
        <span class="soft-label">加密连接</span>
      </div>
      <div class="setting-row">
        <div>
          <strong>自动保存凭据</strong>
          <p>密码与私钥口令加密保存在本机，验证成功后可直接连接。</p>
        </div>
        <AppIcon name="lock" :size="18" />
      </div>
      <div class="setting-row">
        <div>
          <strong>服务器指纹</strong>
          <p>首次连接需确认，指纹变化时阻止连接。</p>
        </div>
        <AppIcon name="safe" :size="18" />
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-heading">
        <span class="settings-section-icon"
          ><AppIcon name="folder" :size="19"
        /></span>
        <div>
          <h2>服务器配置与数据</h2>
          <p>导入、导出与本地备份</p>
        </div>
      </div>
      <div class="data-directory">
        <span>当前数据目录</span><code>{{ directory || "正在读取…" }}</code>
      </div>
      <p class="form-note">
        ssh-go
        使用独立数据目录。连接配置导出不包含密码、私钥口令、私钥文件和服务器信任记录。完整数据备份需要复制整个数据目录，其中包含加密凭据和本地密钥。
      </p>
      <div class="settings-actions">
        <a-button :disabled="busy || !api.desktopAvailable" @click="exportNow"
          ><template #icon><AppIcon name="download" :size="16" /></template
          >导出连接配置</a-button
        ><a-button
          :disabled="busy || !api.desktopAvailable"
          @click="chooseImport('json')"
          >导入 JSON 配置</a-button
        ><a-button
          :disabled="busy || !api.desktopAvailable"
          @click="chooseImport('openssh')"
          >导入 OpenSSH 配置</a-button
        >
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-heading">
        <span class="settings-section-icon"
          ><AppIcon name="check" :size="19"
        /></span>
        <div>
          <h2>已信任的服务器</h2>
          <p>核对新指纹后再移除旧信任，下次连接会重新确认。</p>
        </div>
        <span class="section-count">{{ known.length }}</span>
      </div>
      <p v-if="!known.length" class="settings-empty">还没有已信任的服务器。</p>
      <div
        v-for="host in known"
        :key="host.address + ':' + host.port"
        class="known-host"
      >
        <div>
          <strong class="mono">{{ host.address }}:{{ host.port }}</strong
          ><code>{{ host.fingerprint }}</code>
        </div>
        <a-button
          type="text"
          status="danger"
          :disabled="busy"
          @click="
            forget = host;
            error = '';
          "
          >移除信任</a-button
        >
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-heading">
        <span class="settings-section-icon"
          ><AppIcon name="info" :size="19"
        /></span>
        <div>
          <h2>资源与状态</h2>
          <p>轻量采样，清晰反馈</p>
        </div>
      </div>
      <div class="setting-row">
        <div>
          <strong>本机资源</strong>
          <p>
            每 3 秒采样，窗口隐藏时暂停。{{ w.resource.value?.scope || '统计主进程，不含 WebView。' }}
          </p>
        </div>
      </div>
      <div class="setting-row">
        <div>
          <strong>命令执行状态</strong>
          <p>支持 OSC 133 / 633 的 shell 可报告状态，不从键盘输入推测命令。</p>
        </div>
      </div>
    </div>
    <footer class="settings-footer">
      <strong>ssh-go</strong><span>0.1.0 · SSH & SFTP 桌面工作区</span>
    </footer>
  </section>
  <BaseModal
    v-if="preview"
    title="导入服务器配置"
    description="核对连接和提示后确认导入。现有重复连接会被跳过。"
    :width="600"
    :busy="busy"
    @close="
      preview = null;
      error = '';
    "
    ><div v-if="preview.warnings.length" class="import-warnings">
      <p v-for="warning in preview.warnings" :key="warning">
        <AppIcon name="info" :size="15" />{{ warning }}
      </p>
    </div>
    <div class="import-preview">
      <div v-for="h in preview.hosts" :key="h.id">
        <AppIcon name="server" :size="17" /><strong>{{ h.name }}</strong
        ><span class="mono">{{ h.username }}@{{ h.address }}:{{ h.port }}</span>
      </div>
    </div>
    <p v-if="!preview.hosts.length" class="form-note">
      配置中没有可导入的服务器。
    </p>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <div class="modal-actions">
      <a-button :disabled="busy" @click="preview = null">取消</a-button
      ><a-button
        type="primary"
        :loading="busy"
        :disabled="!preview.hosts.length"
        @click="importNow"
        >确认导入</a-button
      >
    </div></BaseModal
  >
  <BaseModal
    v-if="forget"
    title="移除服务器信任"
    description="请先从可信渠道核对服务器身份，移除后下次连接会重新确认。"
    :width="500"
    :busy="busy"
    @close="
      forget = null;
      error = '';
    "
    ><div class="fingerprint-review">
      <strong>{{ forget.address }}:{{ forget.port }}</strong
      ><code>{{ forget.fingerprint }}</code>
    </div>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <div class="modal-actions">
      <a-button :disabled="busy" @click="forget = null">取消</a-button
      ><a-button
        type="primary"
        status="danger"
        :loading="busy"
        @click="forgetNow"
        >确认移除信任</a-button
      >
    </div></BaseModal
  >
</template>
