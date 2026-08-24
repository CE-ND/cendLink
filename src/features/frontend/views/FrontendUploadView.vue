<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  ChevronRight,
  CircleCheck,
  Container,
  FileArchive,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  UploadCloud,
} from '@lucide/vue'
import AppSelect from '../../../components/ui/AppSelect.vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'
import RunProgress from '../../workspace/components/RunProgress.vue'
import CopyButton from '../../../components/ui/CopyButton.vue'
import InlineDeleteConfirm from '../../../components/ui/InlineDeleteConfirm.vue'
import {
  AUTO_NGINX_PUBLISH_COMMAND,
  buildDockerNginxPublishCommand,
} from '../../../shared/nginxDeployment.js'

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
  frontendProjectSaveError,
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
  selectDroppedFrontendArchiveFile,
  refreshFrontendUploadPreview,
  runFrontendUpload,
} = useWorkspaceSession()

const emit = defineEmits(['open-logs'])

// 前端上传管线的锚定步骤（名称与 frontendUploadRunner 的 runStep 一致）。
const BASE_FRONTEND_STAGES = [
  { key: 'precheck', label: '远程预检' },
  { key: 'upload', label: '上传压缩包' },
  { key: 'publish', label: '解压并发布' },
]

const pageRef = ref(null)
const isProjectCopyOpen = ref(false)
const projectCopyName = ref('')
const projectCopyError = ref('')
const projectCopyInputRef = ref(null)
const frontendProjectSaveNotice = ref(null)
const pendingProjectDelete = ref(null)
const isDeletingProject = ref(false)
const isArchiveDragActive = ref(false)
const archiveDropError = ref('')
const lastCustomNginxCommand = ref(buildDockerNginxPublishCommand())
let archiveDragDepth = 0
usePageEntrance(pageRef)

const extractStrategyOptions = [
  { value: 'clean', label: '清空覆盖' },
  { value: 'backup', label: '备份替换' },
  { value: 'overwrite', label: '直接覆盖' },
]

const isAutomaticNginxRestart = computed(() => {
  return frontendForm.nginxRestartCommand === AUTO_NGINX_PUBLISH_COMMAND
})

const nginxRestartModeLabel = computed(() => {
  return isAutomaticNginxRestart.value ? '自动适配 Docker / 系统服务' : '自定义命令'
})

const nginxRestartPreviewText = computed(() => {
  if (isAutomaticNginxRestart.value) {
    return 'Docker · nginx\n未检测到时 → systemd · nginx.service'
  }

  return frontendUploadPreview.value?.restartCommand || frontendForm.nginxRestartCommand || '等待填写 Nginx 命令'
})

watch(
  () => frontendForm.nginxRestartCommand,
  (command) => {
    if (command?.trim() && command !== AUTO_NGINX_PUBLISH_COMMAND) {
      lastCustomNginxCommand.value = command
    }
  },
  { immediate: true },
)

function setNginxRestartMode(mode) {
  updateFrontendForm({
    nginxRestartCommand:
      mode === 'auto' ? AUTO_NGINX_PUBLISH_COMMAND : lastCustomNginxCommand.value,
  })
}

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

const hasFrontendArchive = computed(() => Boolean(frontendForm.localArchivePath))

const selectedProjectSummary = computed(() => {
  if (!hasFrontendProjectBridge.value) {
    return '前端项目能力需要重启桌面窗口后生效'
  }

  if (!selectedFrontendProject.value) {
    return '保存后可复用该项目的 Nginx 路径和上传策略'
  }

  const project = selectedFrontendProject.value
  const updatedAt = formatRecordTime(project.updatedAt)
  const strategy =
    extractStrategyOptions.find((item) => item.value === project.extractStrategy)?.label ||
    '清空覆盖'

  return [
    `目录 ${project.projectDir || '-'}`,
    `策略 ${strategy}`,
    updatedAt ? `更新 ${updatedAt}` : '尚未更新',
  ].join(' · ')
})

const strategyLabel = computed(() => {
  return extractStrategyOptions.find((item) => item.value === frontendForm.extractStrategy)?.label || '清空覆盖'
})

const frontendStages = computed(() => {
  return frontendForm.restartNginx
    ? [...BASE_FRONTEND_STAGES, { key: 'restart', label: '处理 Nginx' }]
    : BASE_FRONTEND_STAGES
})

const nginxResultLabel = computed(() => {
  if (!frontendUploadResult.value?.restartNginx) {
    return '未执行'
  }

  if (!frontendUploadResult.value.nginxRestarted) {
    return '执行失败'
  }

  const runtimeLabels = {
    docker: 'Docker 已重载',
    systemd: '系统服务已重载',
    custom: '自定义命令已完成',
    auto: '自动适配已完成',
  }

  return runtimeLabels[frontendUploadResult.value.nginxRuntime] || '已完成'
})

// 上传态胶囊：两张面板合并后，原本 panel-header 上的胶囊由页尾操作条统一持有。
const uploadTone = computed(() => {
  if (isUploadingFrontend.value) return 'running'
  if (!frontendUploadResult.value) return ''
  return frontendUploadResult.value.ok ? 'success' : 'failed'
})

const uploadLabel = computed(() => {
  if (isUploadingFrontend.value) return 'Uploading'
  return frontendUploadResult.value?.status || 'Idle'
})

async function saveCurrentFrontendProject() {
  frontendProjectSaveNotice.value = null
  const isUpdating = Boolean(selectedFrontendProject.value)
  const saved = await saveFrontendProjectFromForm()

  if (!saved) {
    frontendProjectSaveNotice.value = {
      type: 'error',
      message: frontendProjectSaveError.value || '前端项目保存失败，请稍后重试',
    }
    return
  }

  frontendProjectSaveNotice.value = {
    type: 'success',
    message: isUpdating
      ? `已更新“${saved.name}”的路径与发布策略`
      : `已保存前端项目“${saved.name}”`,
  }
}

function changeFrontendProject(projectId) {
  frontendProjectSaveNotice.value = null
  pendingProjectDelete.value = null
  isProjectCopyOpen.value = false
  projectCopyError.value = ''
  selectFrontendProject(projectId)
}

function openFrontendProjectCopy() {
  frontendProjectSaveNotice.value = null
  pendingProjectDelete.value = null
  projectCopyName.value = String(
    frontendForm.projectName || selectedFrontendProject.value?.name || '',
  ).trim()
  projectCopyError.value = ''
  isProjectCopyOpen.value = true

  void nextTick(() => {
    projectCopyInputRef.value?.focus()
    projectCopyInputRef.value?.select()
  })
}

function closeFrontendProjectCopy() {
  if (isSavingFrontendProject.value) {
    return
  }

  isProjectCopyOpen.value = false
  projectCopyError.value = ''
}

async function saveFrontendProjectCopy() {
  const name = projectCopyName.value.trim()

  if (!name) {
    projectCopyError.value = '请输入前端项目名称'
    projectCopyInputRef.value?.focus()
    return
  }

  const saved = await saveFrontendProjectFromForm({
    createNew: true,
    name,
  })

  if (saved) {
    isProjectCopyOpen.value = false
    projectCopyError.value = ''
    frontendProjectSaveNotice.value = {
      type: 'success',
      message: `已另存前端项目“${saved.name}”`,
    }
    return
  }

  projectCopyError.value = frontendProjectSaveError.value || '保存失败，请稍后重试'
}

function removeSelectedFrontendProject() {
  if (!selectedFrontendProject.value) {
    return
  }

  isProjectCopyOpen.value = false
  projectCopyError.value = ''
  pendingProjectDelete.value = {
    id: selectedFrontendProjectId.value,
    name: selectedFrontendProject.value.name,
  }
}

function closeFrontendProjectDelete() {
  if (!isDeletingProject.value) {
    pendingProjectDelete.value = null
  }
}

async function confirmFrontendProjectDelete() {
  const target = pendingProjectDelete.value

  if (!target || isDeletingProject.value) {
    return
  }

  isDeletingProject.value = true

  try {
    await deleteFrontendProject(target.id)
    pendingProjectDelete.value = null
  } finally {
    isDeletingProject.value = false
  }
}

function canInteractWithArchiveDropzone() {
  return hasFrontendUploadBridge.value && !isUploadingFrontend.value
}

function handleArchiveDragEnter(event) {
  if (!canInteractWithArchiveDropzone()) {
    return
  }

  archiveDragDepth += 1
  isArchiveDragActive.value = true

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleArchiveDragOver(event) {
  if (canInteractWithArchiveDropzone() && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleArchiveDragLeave() {
  archiveDragDepth = Math.max(0, archiveDragDepth - 1)

  if (archiveDragDepth === 0) {
    isArchiveDragActive.value = false
  }
}

async function handleArchiveDrop(event) {
  archiveDragDepth = 0
  isArchiveDragActive.value = false
  archiveDropError.value = ''

  if (!canInteractWithArchiveDropzone()) {
    return
  }

  const files = Array.from(event.dataTransfer?.files || [])

  if (files.length !== 1) {
    archiveDropError.value =
      files.length > 1 ? '一次只能拖入一个前端压缩包' : '没有读取到拖入的文件'
    return
  }

  const result = await selectDroppedFrontendArchiveFile(files[0])

  if (!result?.ok) {
    archiveDropError.value = result?.message || '无法使用这个文件'
  }
}

async function chooseFrontendArchiveFile() {
  archiveDropError.value = ''
  const result = await selectFrontendArchiveFile()

  if (result && !result.ok && !result.canceled) {
    archiveDropError.value = result.message || '无法使用这个文件'
  }
}

function preventWindowFileDrop(event) {
  event.preventDefault()
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
  window.addEventListener('dragover', preventWindowFileDrop)
  window.addEventListener('drop', preventWindowFileDrop)
  loadFrontendProjects()
  refreshFrontendUploadPreview()
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', preventWindowFileDrop)
  window.removeEventListener('drop', preventWindowFileDrop)
})

watch(
  () => frontendForm.localArchivePath,
  () => {
    archiveDropError.value = ''
  },
)

watch(
  frontendForm,
  () => {
    frontendProjectSaveNotice.value = null
  },
  { deep: true },
)
</script>

<template>
  <div ref="pageRef" class="frontend-upload-view">
    <section class="frontend-console">
      <div class="frontend-body">
        <div class="frontend-fields-col">
          <div class="form-group">
            <p class="form-group-title">前端项目</p>

            <div class="template-picker-row service-template-row">
              <AppSelect
                :model-value="selectedFrontendProjectId"
                :options="frontendProjectOptions"
                :disabled="!hasFrontendProjectBridge || isDeletingProject"
                @change="changeFrontendProject"
              />
              <button
                type="button"
                class="secondary-button compact-button"
                :class="{ 'is-loading': isSavingFrontendProject }"
                :aria-busy="isSavingFrontendProject"
                :disabled="
                  !hasFrontendProjectBridge ||
                  isSavingFrontendProject ||
                  isDeletingProject
                "
                @click="saveCurrentFrontendProject"
              >
                <span
                  v-if="isSavingFrontendProject"
                  class="btn-spinner"
                  aria-hidden="true"
                ></span>
                {{
                  isSavingFrontendProject
                    ? selectedFrontendProject
                      ? '更新中...'
                      : '保存中...'
                    : selectedFrontendProject
                      ? '更新项目'
                      : '保存项目'
                }}
              </button>
              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="
                  !hasFrontendProjectBridge ||
                  isSavingFrontendProject ||
                  isDeletingProject
                "
                @click="openFrontendProjectCopy"
              >
                另存
              </button>
              <button
                v-if="selectedFrontendProject"
                type="button"
                class="danger-button template-delete-trigger"
                title="删除当前前端项目"
                aria-label="删除当前前端项目"
                :disabled="isSavingFrontendProject || isDeletingProject"
                @click="removeSelectedFrontendProject"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </div>

            <InlineDeleteConfirm
              v-if="pendingProjectDelete"
              title="删除前端项目？"
              :message="`前端项目「${pendingProjectDelete.name}」将从本地项目库中移除，已上传的远程文件不会受影响。`"
              :busy="isDeletingProject"
              @cancel="closeFrontendProjectDelete"
              @confirm="confirmFrontendProjectDelete"
            />

            <div v-if="isProjectCopyOpen" class="service-template-copy-form">
              <label class="field">
                <span>新前端项目名称</span>
                <input
                  ref="projectCopyInputRef"
                  v-model="projectCopyName"
                  type="text"
                  autocomplete="off"
                  placeholder="例如 console-web-staging"
                  @input="projectCopyError = ''"
                  @keydown.esc.stop="closeFrontendProjectCopy"
                  @keydown.enter.prevent="saveFrontendProjectCopy"
                />
                <small
                  v-if="projectCopyError"
                  class="service-template-copy-error"
                  role="alert"
                >
                  {{ projectCopyError }}
                </small>
              </label>
              <div class="service-template-copy-actions">
                <button
                  type="button"
                  class="secondary-button compact-button"
                  :disabled="isSavingFrontendProject"
                  @click="closeFrontendProjectCopy"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="primary-button compact-button"
                  :disabled="isSavingFrontendProject"
                  @click="saveFrontendProjectCopy"
                >
                  {{ isSavingFrontendProject ? '保存中...' : '保存副本' }}
                </button>
              </div>
            </div>

            <small class="template-description">
              {{ selectedProjectSummary }}
            </small>
            <div
              v-if="frontendProjectSaveNotice"
              class="service-template-save-notice"
              :class="frontendProjectSaveNotice.type"
              :role="frontendProjectSaveNotice.type === 'error' ? 'alert' : 'status'"
              aria-live="polite"
            >
              <CircleCheck
                v-if="frontendProjectSaveNotice.type === 'success'"
                :size="14"
                aria-hidden="true"
              />
              <AlertCircle v-else :size="14" aria-hidden="true" />
              <span>{{ frontendProjectSaveNotice.message }}</span>
            </div>
          </div>

          <div class="form-group">
            <div class="form-group-head">
              <p class="form-group-title">前端压缩包</p>
              <span class="deploy-source-pill">zip / tar</span>
            </div>

            <button
              type="button"
              class="file-dropzone frontend-archive-dropzone"
              :class="{
                'is-dragging': isArchiveDragActive,
                'has-file': hasFrontendArchive,
                'has-error': archiveDropError,
              }"
              :disabled="!hasFrontendUploadBridge || isUploadingFrontend"
              :aria-label="
                hasFrontendArchive
                  ? `更换前端压缩包：${currentArchiveFileName}`
                  : '选择或拖入前端压缩包'
              "
              @click="chooseFrontendArchiveFile"
              @dragenter.prevent.stop="handleArchiveDragEnter"
              @dragover.prevent.stop="handleArchiveDragOver"
              @dragleave.prevent.stop="handleArchiveDragLeave"
              @drop.prevent.stop="handleArchiveDrop"
            >
              <div class="file-dropzone-icon" aria-hidden="true">
                <UploadCloud v-if="isArchiveDragActive" :size="19" />
                <FileArchive v-else :size="19" />
              </div>
              <div class="file-dropzone-copy">
                <strong>
                  {{
                    isArchiveDragActive
                      ? '释放以上传这个压缩包'
                      : currentArchiveFileName || '拖入前端压缩包'
                  }}
                </strong>
                <small :title="frontendForm.localArchivePath">
                  {{
                    isArchiveDragActive
                      ? '仅接收单个 zip、tar、tar.gz 或 tgz 文件'
                      : frontendForm.localArchivePath || '也可以点击此区域从本机选择'
                  }}
                </small>
              </div>
              <div class="file-dropzone-action" aria-hidden="true">
                <Upload :size="14" />
                <b>{{ hasFrontendArchive ? '更换' : '选择' }}</b>
              </div>
            </button>
            <small
              v-if="archiveDropError"
              class="file-dropzone-message error"
              role="alert"
            >
              {{ archiveDropError }}
            </small>
            <small v-else class="file-dropzone-message">
              {{
                hasFrontendUploadBridge
                  ? '支持拖放或点击选择前端压缩包'
                  : '请通过 Electron 模式选择本地文件'
              }}
            </small>
          </div>

          <div class="form-group">
            <p class="form-group-title">发布目标</p>

            <label class="field">
              <span>目标服务器</span>
              <input :value="targetServerLabel" type="text" readonly />
            </label>

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
          </div>

          <div class="form-group">
            <p class="form-group-title">发布选项</p>

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
              <div class="field fill">
                <span>远程压缩包</span>
                <button
                  type="button"
                  class="deploy-check-switch"
                  :class="{ active: frontendForm.keepRemoteArchive }"
                  role="switch"
                  :aria-checked="frontendForm.keepRemoteArchive"
                  @click="
                    updateFrontendForm({
                      keepRemoteArchive: !frontendForm.keepRemoteArchive,
                    })
                  "
                >
                  <span>{{ frontendForm.keepRemoteArchive ? '发布后保留' : '发布后删除' }}</span>
                  <span class="deploy-check-switch-track" aria-hidden="true"><i></i></span>
                </button>
              </div>
            </div>
          </div>

          <div class="form-group">
            <p class="form-group-title">发布后动作</p>

            <button
              type="button"
              class="frontend-restart-control"
              :class="{ active: frontendForm.restartNginx }"
              role="switch"
              :aria-checked="frontendForm.restartNginx"
              :disabled="isUploadingFrontend"
              @click="updateFrontendForm({ restartNginx: !frontendForm.restartNginx })"
            >
              <span class="frontend-restart-icon" aria-hidden="true">
                <RefreshCw :size="17" :stroke-width="2.1" />
              </span>
              <span class="frontend-restart-copy">
                <strong>发布完成后处理 Nginx</strong>
                <small>{{ frontendForm.restartNginx ? '将在文件发布成功后执行' : '本次发布不会操作 Nginx' }}</small>
              </span>
              <span class="frontend-restart-track" aria-hidden="true"><i></i></span>
            </button>

            <div v-if="frontendForm.restartNginx" class="field frontend-nginx-mode">
              <span>执行方式</span>
              <div
                class="segmented frontend-nginx-segmented"
                :class="{ 'is-custom': !isAutomaticNginxRestart }"
                role="group"
                aria-label="Nginx 发布后执行方式"
              >
                <span class="segment-thumb" aria-hidden="true"></span>
                <button
                  type="button"
                  :class="{ selected: isAutomaticNginxRestart }"
                  :aria-pressed="isAutomaticNginxRestart"
                  :disabled="isUploadingFrontend"
                  @click="setNginxRestartMode('auto')"
                >
                  自动适配
                </button>
                <button
                  type="button"
                  :class="{ selected: !isAutomaticNginxRestart }"
                  :aria-pressed="!isAutomaticNginxRestart"
                  :disabled="isUploadingFrontend"
                  @click="setNginxRestartMode('custom')"
                >
                  自定义命令
                </button>
              </div>

              <div
                v-if="isAutomaticNginxRestart"
                class="frontend-nginx-runtime-route"
                role="img"
                aria-label="优先使用 Docker 容器 nginx，未检测到时回退到系统服务 nginx.service"
              >
                <span><Container :size="14" /> Docker · nginx</span>
                <ChevronRight :size="14" aria-hidden="true" />
                <span><Server :size="14" /> systemd · nginx.service</span>
              </div>
            </div>

            <label
              v-if="frontendForm.restartNginx && !isAutomaticNginxRestart"
              class="field frontend-restart-command"
              :class="{ 'is-invalid': !frontendForm.nginxRestartCommand.trim() }"
            >
              <span>发布后命令</span>
              <input
                :value="frontendForm.nginxRestartCommand"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="docker exec nginx nginx -t && docker exec nginx nginx -s reload"
                :aria-invalid="!frontendForm.nginxRestartCommand.trim()"
                :disabled="isUploadingFrontend"
                @input="updateFrontendForm({ nginxRestartCommand: $event.target.value })"
              />
              <small v-if="!frontendForm.nginxRestartCommand.trim()" role="alert">
                启用后需要填写发布后命令
              </small>
            </label>
          </div>
        </div>

        <div class="frontend-preview-col">
          <div
            class="preview-identity"
            :class="{ empty: !(frontendUploadPreview?.remoteTargetDir || frontendForm.remoteTargetDir) }"
          >
            <div class="preview-identity-main">
              <span class="preview-identity-label">发布目录</span>
              <strong :title="frontendUploadPreview?.remoteTargetDir || frontendForm.remoteTargetDir">
                {{ frontendUploadPreview?.remoteTargetDir || frontendForm.remoteTargetDir || '等待填写上传参数' }}
              </strong>
            </div>
            <CopyButton
              v-if="frontendUploadPreview?.remoteTargetDir || frontendForm.remoteTargetDir"
              :value="frontendUploadPreview?.remoteTargetDir || frontendForm.remoteTargetDir"
              label="复制发布目录"
            />
          </div>

          <div class="preview-groups">
            <section class="preview-group">
              <p class="preview-group-title">远程路径</p>
              <dl class="preview-list">
                <div class="preview-row">
                  <dt>目标服务器</dt>
                  <dd :title="targetServerLabel">{{ targetServerLabel }}</dd>
                </div>
                <div class="preview-row">
                  <dt>基础路径</dt>
                  <dd class="mono" :title="frontendUploadPreview?.remoteBaseDir || frontendForm.remoteBaseDir">
                    {{ frontendUploadPreview?.remoteBaseDir || frontendForm.remoteBaseDir || '-' }}
                  </dd>
                </div>
                <div class="preview-row">
                  <dt>项目目录</dt>
                  <dd :title="frontendUploadPreview?.projectDir || frontendForm.projectDir">
                    {{ frontendUploadPreview?.projectDir || frontendForm.projectDir || '-' }}
                  </dd>
                </div>
              </dl>
            </section>

            <section class="preview-group">
              <p class="preview-group-title">发布配置</p>
              <dl class="preview-list">
                <div class="preview-row">
                  <dt>远程压缩包</dt>
                  <dd class="mono" :title="frontendUploadPreview?.remoteArchivePath">
                    {{ frontendUploadPreview?.remoteArchivePath || '-' }}
                  </dd>
                </div>
                <div class="preview-row">
                  <dt>发布策略</dt>
                  <dd>{{ strategyLabel }}</dd>
                </div>
                <div class="preview-row">
                  <dt>入口文件</dt>
                  <dd>{{ frontendForm.entryFile || 'index.html' }}</dd>
                </div>
                <div class="preview-row">
                  <dt>Nginx 动作</dt>
                  <dd>{{ frontendForm.restartNginx ? nginxRestartModeLabel : '未启用' }}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div class="frontend-preview-scroll">
            <section class="preview-commands">
              <div class="preview-command">
                <div class="preview-group-head">
                  <p class="preview-group-title">远程预检</p>
                  <CopyButton
                    v-if="frontendUploadPreview?.precheckCommand"
                    :value="frontendUploadPreview.precheckCommand"
                    label="复制命令"
                  />
                </div>
                <div class="command-panel">
                  <pre><code>{{ frontendUploadPreview?.precheckCommand || '等待填写上传参数' }}</code></pre>
                </div>
              </div>

              <div class="preview-command">
                <div class="preview-group-head">
                  <p class="preview-group-title">发布动作</p>
                  <CopyButton
                    v-if="frontendUploadPreview?.publishCommand"
                    :value="frontendUploadPreview.publishCommand"
                    label="复制命令"
                  />
                </div>
                <div class="command-panel">
                  <pre><code>{{ frontendUploadPreview?.publishCommand || '等待选择前端压缩包' }}</code></pre>
                </div>
              </div>

              <div v-if="frontendForm.restartNginx" class="preview-command">
                <div class="preview-group-head">
                  <p class="preview-group-title">Nginx 发布后动作</p>
                  <CopyButton
                    v-if="frontendUploadPreview?.restartCommand"
                    :value="frontendUploadPreview.restartCommand"
                    label="复制 Nginx 命令"
                  />
                </div>
                <div class="command-panel">
                  <pre><code>{{ nginxRestartPreviewText }}</code></pre>
                </div>
              </div>
            </section>
          </div>

          <div v-if="isUploadingFrontend || frontendUploadResult" class="package-result-block">
            <RunProgress
              :active="isUploadingFrontend"
              :result="frontendUploadResult"
              :stages="frontendStages"
              :running-text="frontendForm.restartNginx ? '正在发布前端包并处理 Nginx…' : '正在上传并发布前端包…'"
            />
            <div v-if="frontendUploadResult && !isUploadingFrontend" class="command-meta">
              <span class="command-stat">文件: {{ frontendUploadResult.publishedFileCount || 0 }}</span>
              <span class="command-stat">备份: {{ frontendUploadResult.backupDir || '-' }}</span>
              <span class="command-stat">Nginx: {{ nginxResultLabel }}</span>
            </div>
          </div>
        </div>
      </div>

      <footer class="console-foot">
        <div class="console-status">
          <span class="state-pill" :class="uploadTone">{{ uploadLabel }}</span>
          <p class="console-hint" :title="frontendUploadHint">{{ frontendUploadHint }}</p>
        </div>
        <div class="console-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="!hasFrontendUploadBridge"
            @click="refreshFrontendUploadPreview"
          >
            刷新预览
          </button>
          <button class="secondary-button" type="button" @click="emit('open-logs')">
            查看日志
          </button>
          <button
            class="primary-button"
            type="button"
            :class="{ 'is-loading': isUploadingFrontend }"
            :aria-busy="isUploadingFrontend"
            :disabled="!canUploadFrontend || isUploadingFrontend"
            @click="runFrontendUpload"
          >
            <span v-if="isUploadingFrontend" class="btn-spinner" aria-hidden="true"></span>
            {{ isUploadingFrontend ? '上传中…' : '开始上传' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
