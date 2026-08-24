<script setup>
import { computed, ref } from 'vue'
import ConnectionForm from '../components/ConnectionForm.vue'
import ConnectionStatus from '../components/ConnectionStatus.vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'

// 服务器页只负责 SSH 配置编辑和连接测试。
// 表单与状态合并为一张控制台卡片：三个动作与连接态胶囊上移到共享操作条，
// 下方左右两栏（配置 / 状态）共用同一张 surface，不再是两块各自带框的面板。
const {
  form,
  result,
  isTesting,
  isExecutingCommand,
  isSavingServer,
  isCreatingServer,
  needsRetest,
  serverMetrics,
  isLoadingMetrics,
  metricsError,
  updateForm,
  saveCurrentServer,
  createNewServer,
  testConnection,
  selectPrivateKeyFile,
  refreshServerMetrics,
} = useWorkspaceSession()

const pageRef = ref(null)
usePageEntrance(pageRef)

const isBusy = computed(() => isTesting.value || isExecutingCommand.value)

// 连接态胶囊原先在状态面板头部，合并后由本视图统一持有。
const connectionTone = computed(() => {
  if (isTesting.value) {
    return 'running'
  }

  if (needsRetest.value) {
    return 'warning'
  }

  if (!result.value) {
    return ''
  }

  return result.value.ok ? 'success' : 'failed'
})

const connectionLabel = computed(() => {
  if (isTesting.value) {
    return 'Testing'
  }

  if (needsRetest.value) {
    return 'Retest Required'
  }

  return result.value?.status || 'Idle'
})

const saveLabel = computed(() => {
  if (isSavingServer.value) {
    return '保存中...'
  }

  return isCreatingServer.value ? '保存新服务器' : '保存修改'
})
</script>

<template>
  <div ref="pageRef" class="connection-board">
    <section class="connection-console">
      <header class="console-bar">
        <span class="state-pill" :class="connectionTone">{{ connectionLabel }}</span>

        <div class="console-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy || isSavingServer"
            @click="createNewServer"
          >
            新建
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy || isSavingServer"
            @click="saveCurrentServer"
          >
            {{ saveLabel }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="isBusy || isSavingServer"
            @click="testConnection"
          >
            {{ isTesting ? '测试中...' : '测试连接' }}
          </button>
        </div>
      </header>

      <div class="console-body">
        <ConnectionForm
          :model-value="form"
          @update:model-value="updateForm"
          @select-key="selectPrivateKeyFile"
          @test="testConnection"
        />

        <ConnectionStatus
          :result="result"
          :target="{ username: form.username, host: form.host, port: form.port }"
          :busy="isTesting"
          :stale="needsRetest"
          :metrics="serverMetrics"
          :metrics-loading="isLoadingMetrics"
          :metrics-error="metricsError"
          @refresh-metrics="refreshServerMetrics"
        />
      </div>
    </section>
  </div>
</template>
