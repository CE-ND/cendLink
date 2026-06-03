<script setup>
import { computed, onMounted } from 'vue'
import AppSelect from '../../../components/ui/AppSelect.vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

const {
  savedServers,
  activeServerId,
  frontendForm,
  frontendProjects,
  selectedFrontendProject,
  selectedFrontendProjectId,
  frontendUploadPreview,
  frontendUploadResult,
  isUploadingFrontend,
  isSavingFrontendProject,
  canUploadFrontend,
  frontendUploadHint,
  hasFrontendUploadBridge,
  hasFrontendProjectBridge,
  updateFrontendForm,
  loadFrontendProjects,
  selectFrontendProject,
  saveFrontendProjectFromForm,
  deleteFrontendProject,
  selectFrontendArchiveFile,
  refreshFrontendUploadPreview,
  runFrontendUpload,
} = useWorkspaceSession()

const emit = defineEmits(['open-logs'])

const extractStrategyOptions = [
  { value: 'clean', label: '清空覆盖' },
  { value: 'backup', label: '备份替换' },
  { value: 'overwrite', label: '直接覆盖' },
]

const selectedServer = computed(() => {
  return savedServers.value.find((item) => item.id === activeServerId.value) || null
})

const targetServerLabel = computed(() => {
  if (!selectedServer.value) {
    return '未选择服务器'
  }

  return `${selectedServer.value.name} · ${selectedServer.value.host}:${selectedServer.value.port}`
})

const frontendProjectOptions = computed(() => {
  return [
    { value: '', label: '未选择前端项目' },
    ...frontendProjects.value.map((project) => ({
      value: project.id,
      label: project.name,
    })),
  ]
})

const currentArchiveFileName = computed(() => {
  return getFileName(frontendForm.localArchivePath)
})

const selectedProjectSummary = computed(() => {
  if (!hasFrontendProjectBridge.value) {
    return '前端项目能力需要重启桌面窗口后生效'
  }

  if (!selectedFrontendProject.value) {
    return '保存后可复用该项目的 Nginx 路径和上传策略'
  }

  const uploadedAt = formatRecordTime(selectedFrontendProject.value.lastUploadedAt)
  return uploadedAt ? `最近上传 ${uploadedAt}` : '尚未记录上传'
})

const strategyLabel = computed(() => {
  return extractStrategyOptions.find((item) => item.value === frontendForm.extractStrategy)?.label || '清空覆盖'
})

const uploadSummaryItems = computed(() => {
  return [
    { label: '目标', value: selectedServer.value ? selectedServer.value.name : '未选择' },
    { label: '项目目录', value: frontendForm.projectDir || '-' },
    { label: '发布策略', value: strategyLabel.value },
  ]
})

function saveCurrentFrontendProject() {
  return saveFrontendProjectFromForm()
}

async function createFrontendProjectCopy() {
  const name = window.prompt('前端项目名称', frontendForm.projectName || selectedFrontendProject.value?.name || '')

  if (name === null) {
    return
  }

  await saveFrontendProjectFromForm({
    createNew: true,
    name,
  })
}

async function removeSelectedFrontendProject() {
  if (!selectedFrontendProject.value) {
    return
  }

  const confirmed = window.confirm(`确定删除前端项目「${selectedFrontendProject.value.name}」吗？`)

  if (!confirmed) {
    return
  }

  await deleteFrontendProject(selectedFrontendProjectId.value)
}

function getFileName(filePath) {
  const value = String(filePath || '').trim()

  if (!value) {
    return ''
  }

  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

function formatRecordTime(value) {
  if (!value) {
    return ''
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return String(value)
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

onMounted(() => {
  loadFrontendProjects()
  refreshFrontendUploadPreview()
})
</script>

<template>
  <div class="deploy-view frontend-upload-view">
    <section class="panel deploy-panel deploy-form-panel frontend-upload-form-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Frontend Upload</p>
          <h3>前端静态包发布</h3>
        </div>
        <span
          class="state-pill"
          :class="{ success: frontendUploadResult?.ok, failed: frontendUploadResult && !frontendUploadResult.ok }"
        >
          {{ isUploadingFrontend ? 'Uploading' : frontendUploadResult?.status || 'Idle' }}
        </span>
      </div>

      <div class="deploy-form-body">
        <div class="deploy-fields">
          <section class="deploy-section service-template-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">前端项目</span>
                <strong>路径与策略</strong>
              </div>
            </div>

            <div class="template-picker-row service-template-row">
              <AppSelect
                :model-value="selectedFrontendProjectId"
                :options="frontendProjectOptions"
                :disabled="!hasFrontendProjectBridge"
                @change="selectFrontendProject($event)"
              />
              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="!hasFrontendProjectBridge || isSavingFrontendProject"
                @click="saveCurrentFrontendProject"
              >
                {{ selectedFrontendProject ? '更新项目' : '保存项目' }}
              </button>
              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="!hasFrontendProjectBridge || isSavingFrontendProject"
                @click="createFrontendProjectCopy"
              >
                另存
              </button>
              <button
                v-if="selectedFrontendProject"
                type="button"
                class="danger-button compact-button"
                :disabled="isSavingFrontendProject"
                @click="removeSelectedFrontendProject"
              >
                删除
              </button>
            </div>

            <small class="template-description">
              {{ selectedProjectSummary }}
            </small>
          </section>

          <div class="deploy-package-summary frontend-archive-summary" :class="{ empty: !frontendForm.localArchivePath }">
            <div class="deploy-summary-head">
              <span class="field-prompt">当前压缩包</span>
              <span class="deploy-source-pill">前端构建产物</span>
            </div>

            <div class="deploy-summary-main">
              <strong :title="currentArchiveFileName">{{ currentArchiveFileName || '还没有选择前端压缩包' }}</strong>
              <small :title="frontendForm.localArchivePath">
                {{ frontendForm.localArchivePath || '支持 zip、tar、tar.gz、tgz' }}
              </small>
            </div>

            <div class="deploy-summary-footer">
              <div class="deploy-summary-metrics">
                <span>
                  <small>项目</small>
                  <b :title="frontendForm.projectName">{{ frontendForm.projectName || '-' }}</b>
                </span>
                <span>
                  <small>入口</small>
                  <b>{{ frontendForm.entryFile || 'index.html' }}</b>
                </span>
              </div>

              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="!hasFrontendUploadBridge"
                @click="selectFrontendArchiveFile"
              >
                选择
              </button>
            </div>
          </div>

          <section class="deploy-section deploy-target-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">目标确认</span>
                <strong>服务器与发布目录</strong>
              </div>
            </div>

            <label class="field">
              <span>目标服务器</span>
              <input :value="targetServerLabel" type="text" readonly />
            </label>

            <div class="deploy-confirm-strip">
              <span v-for="item in uploadSummaryItems" :key="item.label">
                <small>{{ item.label }}</small>
                <b>{{ item.value }}</b>
              </span>
            </div>
          </section>

          <section class="deploy-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">Nginx 目录</span>
                <strong>基础路径与项目路径</strong>
              </div>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>项目名称</span>
                <input
                  :value="frontendForm.projectName"
                  type="text"
                  @input="updateFrontendForm({ projectName: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>项目目录</span>
                <input
                  :value="frontendForm.projectDir"
                  type="text"
                  @input="updateFrontendForm({ projectDir: $event.target.value })"
                />
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>基础路径</span>
                <input
                  :value="frontendForm.remoteBaseDir"
                  type="text"
                  @input="updateFrontendForm({ remoteBaseDir: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>发布目录</span>
                <input
                  :value="frontendForm.remoteTargetDir"
                  type="text"
                  @input="updateFrontendForm({ remoteTargetDir: $event.target.value })"
                />
              </label>
            </div>
          </section>

          <section class="deploy-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">发布选项</span>
                <strong>解压、校验与远程包</strong>
              </div>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>发布策略</span>
                <AppSelect
                  :model-value="frontendForm.extractStrategy"
                  :options="extractStrategyOptions"
                  @change="updateFrontendForm({ extractStrategy: $event })"
                />
              </label>
              <label class="field fill">
                <span>入口文件</span>
                <input
                  :value="frontendForm.entryFile"
                  type="text"
                  @input="updateFrontendForm({ entryFile: $event.target.value })"
                />
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>上传缓存目录</span>
                <input
                  :value="frontendForm.remoteUploadDir"
                  type="text"
                  @input="updateFrontendForm({ remoteUploadDir: $event.target.value })"
                />
              </label>
              <label class="field checkbox-field frontend-keep-archive">
                <input
                  :checked="frontendForm.keepRemoteArchive"
                  type="checkbox"
                  @change="updateFrontendForm({ keepRemoteArchive: $event.target.checked })"
                />
                <span>保留远程压缩包</span>
              </label>
            </div>
          </section>
        </div>

        <div class="package-actions deploy-actions">
          <div class="panel-actions">
            <button
              class="primary-button"
              type="button"
              :disabled="!canUploadFrontend || isUploadingFrontend"
              @click="runFrontendUpload"
            >
              {{ isUploadingFrontend ? '上传中...' : '开始上传' }}
            </button>
            <button
              class="secondary-button"
              type="button"
              :disabled="!hasFrontendUploadBridge"
              @click="refreshFrontendUploadPreview"
            >
              刷新预览
            </button>
            <button class="secondary-button" type="button" @click="emit('open-logs')">查看日志</button>
          </div>

          <div
            class="deploy-action-status"
            :class="{ active: isUploadingFrontend, ok: frontendUploadResult?.ok, failed: frontendUploadResult && !frontendUploadResult.ok }"
          >
            <span></span>
            <p class="command-hint">{{ frontendUploadHint }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="panel deploy-panel deploy-preview-panel frontend-upload-preview-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Upload Plan</p>
          <h3>上传预览</h3>
        </div>
        <span class="state-pill">{{ frontendUploadPreview?.projectName || 'Pending' }}</span>
      </div>

      <dl class="package-meta-grid deploy-meta-grid">
        <div>
          <dt>远程压缩包</dt>
          <dd>{{ frontendUploadPreview?.remoteArchivePath || '-' }}</dd>
        </div>
        <div>
          <dt>发布目录</dt>
          <dd>{{ frontendUploadPreview?.remoteTargetDir || frontendForm.remoteTargetDir || '-' }}</dd>
        </div>
        <div>
          <dt>基础路径</dt>
          <dd>{{ frontendUploadPreview?.remoteBaseDir || frontendForm.remoteBaseDir || '-' }}</dd>
        </div>
        <div>
          <dt>项目目录</dt>
          <dd>{{ frontendUploadPreview?.projectDir || frontendForm.projectDir || '-' }}</dd>
        </div>
        <div class="wide">
          <dt>远程预检</dt>
          <dd class="dockerfile-preview">
            <pre><code>{{ frontendUploadPreview?.precheckCommand || '等待填写上传参数' }}</code></pre>
          </dd>
        </div>
        <div class="wide">
          <dt>发布动作</dt>
          <dd class="dockerfile-preview deploy-command-preview">
            <pre><code>{{ frontendUploadPreview?.publishCommand || '等待选择前端压缩包' }}</code></pre>
          </dd>
        </div>
      </dl>

      <div v-if="frontendUploadResult" class="package-result-block">
        <p :class="['result-message', { ok: frontendUploadResult.ok }]">{{ frontendUploadResult.message }}</p>
        <div class="command-meta">
          <span class="command-stat">耗时: {{ frontendUploadResult.durationMs }} ms</span>
          <span class="command-stat">文件: {{ frontendUploadResult.publishedFileCount || 0 }}</span>
          <span class="command-stat">备份: {{ frontendUploadResult.backupDir || '-' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
