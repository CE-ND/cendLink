<script setup>
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

const {
  workspaceSettings,
  settingsResult,
  isSavingSettings,
  hasStorageBridge,
  updateWorkspaceSettings,
  saveWorkspaceSettings,
} = useWorkspaceSession()
</script>

<template>
  <div class="settings-view">
    <section class="settings-group">
      <div class="settings-group-head">
        <strong>远程命令</strong>
        <span>{{ hasStorageBridge ? '已连接本地设置' : '预览模式' }}</span>
      </div>

      <label class="settings-row">
        <span class="settings-row-copy">
          <strong>命令超时</strong>
          <small>超过该时间后自动中断本次 SSH 命令，避免 Docker 查询或日志命令长期无响应。</small>
        </span>

        <span class="settings-input-unit">
          <input
            :value="workspaceSettings.commandTimeoutSeconds"
            type="number"
            min="5"
            max="600"
            step="5"
            @input="updateWorkspaceSettings({ commandTimeoutSeconds: $event.target.value })"
          />
          <b>秒</b>
        </span>
      </label>

      <div class="settings-actions">
        <p
          v-if="settingsResult"
          class="result-message settings-message"
          :class="{ ok: settingsResult.ok }"
        >
          {{ settingsResult.message }}
        </p>

        <button
          class="primary-button"
          type="button"
          :disabled="isSavingSettings || !hasStorageBridge"
          @click="saveWorkspaceSettings"
        >
          {{ isSavingSettings ? '保存中...' : '保存设置' }}
        </button>
      </div>
    </section>
  </div>
</template>
