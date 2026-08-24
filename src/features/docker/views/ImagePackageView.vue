<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileArchive, Trash2, Upload, UploadCloud } from '@lucide/vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import AppSelect from '../../../components/ui/AppSelect.vue'
import { buildBaseImage, parseDockerfileText } from '../../../shared/dockerfileTemplates.js'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'
import RunProgress from '../../workspace/components/RunProgress.vue'
import CopyButton from '../../../components/ui/CopyButton.vue'
import InlineDeleteConfirm from '../../../components/ui/InlineDeleteConfirm.vue'

// 本地镜像包生成页，负责展示 Jar -> Docker 镜像压缩包的完整流程。
const {
  packageForm,
  packagePreview,
  packageResult,
  serviceTemplates,
  selectedServiceTemplate,
  selectedServiceTemplateId,
  dockerfileTemplateOptions,
  selectedDockerfileTemplate,
  isBuildingPackage,
  isSavingDockerfileTemplate,
  isSavingServiceTemplate,
  hasElectronBridge,
  hasServiceTemplateBridge,
  canBuildImagePackage,
  packageHint,
  updatePackageForm,
  loadServiceTemplates,
  loadDockerfileTemplates,
  selectServiceTemplate,
  saveServiceTemplateFromPackage,
  deleteServiceTemplate,
  selectDockerfileTemplate,
  applyImportedDockerfileTemplate,
  saveDockerfileTemplate,
  deleteDockerfileTemplate,
  selectJarFile,
  selectDroppedJarFile,
  refreshPackagePreview,
  buildImagePackage,
  openImagePackageDirectory,
} = useWorkspaceSession()

const emit = defineEmits(['open-logs'])

// 本地打包的锚定步骤（打包器不产出结构化 steps[]，仅作运行中的预期展示；结果由 toast 呈现）。
const PACKAGE_STAGES = [
  { key: 'dockerfile', label: '生成 Dockerfile' },
  { key: 'build', label: 'docker build 构建镜像' },
  { key: 'save', label: 'docker save 导出' },
  { key: 'gzip', label: 'gzip 压缩为 tar.gz' },
]

// 构建态胶囊：两张面板合并后，原本各自头部的胶囊由控制台操作条统一持有。
const buildTone = computed(() => {
  if (isBuildingPackage.value) {
    return 'running'
  }

  if (!packageResult.value) {
    return ''
  }

  return packageResult.value.ok ? 'success' : 'failed'
})

const buildLabel = computed(() => {
  if (isBuildingPackage.value) {
    return 'Building'
  }

  return packageResult.value?.status || 'Idle'
})

const previewLines = computed(() => {
  return packagePreview.value?.dockerfileText?.split('\n') || []
})

// 运行用户：有预览用预览值，否则回退到当前表单（避免无预览时一律显示 root）。
const previewRunUser = computed(() => {
  const source = packagePreview.value || packageForm
  return source.useNonRootUser ? source.appUser || 'spring' : 'root'
})

const isDockerfileImportOpen = ref(false)
const dockerfileImportText = ref('')
const dockerfileTemplateName = ref('')
const dockerfileTemplateDescription = ref('')
const isPackageToastVisible = ref(false)
let packageToastTimer = null

const pageRef = ref(null)
const isServiceTemplateCopyOpen = ref(false)
const serviceTemplateCopyName = ref('')
const serviceTemplateCopyError = ref('')
const serviceTemplateCopyInputRef = ref(null)
const pendingTemplateDelete = ref(null)
const isDeletingTemplate = ref(false)
const isJarDragActive = ref(false)
const jarDropError = ref('')
let jarDragDepth = 0
usePageEntrance(pageRef)

const deleteDialogTitle = computed(() => {
  return pendingTemplateDelete.value?.type === 'dockerfile'
    ? '删除 Dockerfile 模板？'
    : '删除服务模板？'
})

const deleteDialogMessage = computed(() => {
  const target = pendingTemplateDelete.value

  if (!target) {
    return ''
  }

  return target.type === 'dockerfile'
    ? `模板「${target.name}」将从本地模板库中移除，此操作无法撤销。`
    : `服务模板「${target.name}」将被永久删除，已生成的镜像包不会受影响。`
})

const jarFileName = computed(() => {
  return getFileName(packageForm.jarPath)
})

const hasJarFile = computed(() => Boolean(packageForm.jarPath))

const builtinTemplateOptions = computed(() => {
  return dockerfileTemplateOptions.value.filter((template) => template.sourceType === 'builtin')
})

const customTemplateOptions = computed(() => {
  return dockerfileTemplateOptions.value.filter((template) => template.sourceType !== 'builtin')
})

const serviceTemplateSelectOptions = computed(() => {
  return [
    { value: '', label: '未选择服务模板' },
    ...serviceTemplates.value.map((template) => ({
      value: template.id,
      label: template.name,
    })),
  ]
})

const dockerfileSelectOptions = computed(() => {
  return [
    {
      label: '内置模板',
      options: builtinTemplateOptions.value.map((template) => ({
        value: template.id,
        label: template.name,
      })),
    },
    ...(customTemplateOptions.value.length
      ? [
          {
            label: '自定义模板',
            options: customTemplateOptions.value.map((template) => ({
              value: template.id,
              label: template.name,
            })),
          },
        ]
      : []),
  ]
})

const selectedTemplateDescription = computed(() => {
  return selectedDockerfileTemplate.value?.description || packageForm.dockerfileTemplateDescription || ''
})

const selectedServiceTemplateSummary = computed(() => {
  if (!hasServiceTemplateBridge.value) {
    return '服务模板能力需要重启桌面窗口后生效'
  }

  if (!selectedServiceTemplate.value) {
    return '保存后可在打包和部署页复用该服务配置'
  }

  const version =
    selectedServiceTemplate.value.lastPackageVersion ||
    selectedServiceTemplate.value.packageConfig?.serviceVersion ||
    '-'
  const packagedAt = formatTemplateTime(selectedServiceTemplate.value.lastPackagedAt)

  return [`上次版本 ${version}`, packagedAt ? `打包 ${packagedAt}` : '尚未记录打包'].join(' · ')
})

const selectedTemplateSourceLabel = computed(() => {
  return packageForm.dockerfileSourceType === 'custom' ? '自定义' : '内置'
})

const canDeleteSelectedCustomTemplate = computed(() => {
  return (
    packageForm.dockerfileSourceType === 'custom' &&
    packageForm.dockerfileTemplateId &&
    packageForm.dockerfileTemplateId !== 'imported-custom'
  )
})

const dockerfileImportResult = computed(() => {
  return dockerfileImportText.value.trim() ? parseDockerfileText(dockerfileImportText.value) : null
})

const dockerfileImportSummary = computed(() => {
  const result = dockerfileImportResult.value

  if (!result) {
    return []
  }

  return [
    { label: '建议模板', value: result.templateName || '-' },
    { label: '基础镜像', value: result.baseImage || '-' },
    { label: 'Java', value: result.javaVersion || '-' },
    { label: '端口', value: result.servicePort || '-' },
    { label: '运行用户', value: result.useNonRootUser ? result.appUser || 'spring' : 'root' },
    { label: 'JVM 参数', value: result.javaOpts || '-' },
  ]
})

const javaVersionOptions = ['8', '11', '17', '21']

const packageResultStats = computed(() => {
  if (!packageResult.value) {
    return []
  }

  return [
    { label: '耗时', value: formatDuration(packageResult.value.durationMs) },
    { label: '包大小', value: formatBytes(packageResult.value.packageSizeBytes) },
    { label: '输出', value: packageResult.value.packageFileName || '-' },
  ]
})

function formatDuration(value) {
  const milliseconds = Number(value || 0)

  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(1)} s`
  }

  return `${milliseconds} ms`
}

function formatBytes(value) {
  const bytes = Number(value || 0)

  if (!bytes) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatTemplateTime(value) {
  if (!value) {
    return ''
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function showPackageToast() {
  isPackageToastVisible.value = true
  clearPackageToastTimer()

  packageToastTimer = window.setTimeout(() => {
    isPackageToastVisible.value = false
    packageToastTimer = null
  }, packageResult.value?.ok ? 8000 : 12000)
}

function dismissPackageToast() {
  clearPackageToastTimer()
  isPackageToastVisible.value = false
}

function clearPackageToastTimer() {
  if (packageToastTimer) {
    window.clearTimeout(packageToastTimer)
    packageToastTimer = null
  }
}

function openPackageResultDirectory() {
  openImagePackageDirectory()
  dismissPackageToast()
}

function updateJavaVersion(javaVersion) {
  const family = packageForm.baseImageFamily || 'alpine'
  const nextValue = {
    javaVersion,
  }

  if (family !== 'custom') {
    nextValue.baseImage = buildBaseImage(family, javaVersion)
  }

  updatePackageForm(nextValue)
}

function openDockerfileImport() {
  dockerfileImportText.value =
    packageForm.dockerfileSourceType === 'custom' ? packageForm.dockerfileTemplateText : ''
  dockerfileTemplateName.value =
    packageForm.dockerfileSourceType === 'custom'
      ? packageForm.dockerfileTemplateName
      : `${packageForm.serviceName || 'custom'} Dockerfile`
  dockerfileTemplateDescription.value =
    packageForm.dockerfileSourceType === 'custom' ? packageForm.dockerfileTemplateDescription : ''
  isDockerfileImportOpen.value = true
}

function closeDockerfileImport() {
  isDockerfileImportOpen.value = false
}

function applyDockerfileImport() {
  const parsed = applyImportedDockerfileTemplate(
    dockerfileImportText.value,
    dockerfileTemplateName.value,
  )

  if (parsed) {
    closeDockerfileImport()
  }
}

async function saveDockerfileImport() {
  const saved = await saveDockerfileTemplate({
    name: dockerfileTemplateName.value,
    description: dockerfileTemplateDescription.value,
    templateText: dockerfileImportText.value,
    metadata: dockerfileImportResult.value,
  })

  if (saved) {
    closeDockerfileImport()
  }
}

function removeSelectedDockerfileTemplate() {
  if (!canDeleteSelectedCustomTemplate.value) {
    return
  }

  isServiceTemplateCopyOpen.value = false
  serviceTemplateCopyError.value = ''
  pendingTemplateDelete.value = {
    type: 'dockerfile',
    id: packageForm.dockerfileTemplateId,
    name: packageForm.dockerfileTemplateName,
  }
}

function getFileName(filePath) {
  const value = String(filePath || '').trim()
  return value.split(/[\\/]/).filter(Boolean).pop() || ''
}

async function saveCurrentServiceTemplate() {
  await saveServiceTemplateFromPackage()
}

function changeServiceTemplate(templateId) {
  pendingTemplateDelete.value = null
  isServiceTemplateCopyOpen.value = false
  serviceTemplateCopyError.value = ''
  selectServiceTemplate(templateId, 'package')
}

function changeDockerfileTemplate(templateId) {
  if (pendingTemplateDelete.value?.type === 'dockerfile') {
    pendingTemplateDelete.value = null
  }

  selectDockerfileTemplate(templateId)
}

function canInteractWithJarDropzone() {
  return hasElectronBridge.value && !isBuildingPackage.value
}

function handleJarDragEnter(event) {
  if (!canInteractWithJarDropzone()) {
    return
  }

  jarDragDepth += 1
  isJarDragActive.value = true

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleJarDragOver(event) {
  if (canInteractWithJarDropzone() && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleJarDragLeave() {
  jarDragDepth = Math.max(0, jarDragDepth - 1)

  if (jarDragDepth === 0) {
    isJarDragActive.value = false
  }
}

async function handleJarDrop(event) {
  jarDragDepth = 0
  isJarDragActive.value = false
  jarDropError.value = ''

  if (!canInteractWithJarDropzone()) {
    return
  }

  const files = Array.from(event.dataTransfer?.files || [])

  if (files.length !== 1) {
    jarDropError.value = files.length > 1 ? '一次只能拖入一个 Jar 文件' : '没有读取到拖入的文件'
    return
  }

  const result = await selectDroppedJarFile(files[0])

  if (!result?.ok) {
    jarDropError.value = result?.message || '无法使用这个文件'
  }
}

async function chooseJarFile() {
  jarDropError.value = ''
  const result = await selectJarFile()

  if (result && !result.ok && !result.canceled) {
    jarDropError.value = result.message || '无法使用这个文件'
  }
}

function preventWindowFileDrop(event) {
  event.preventDefault()
}

function openServiceTemplateCopy() {
  pendingTemplateDelete.value = null
  serviceTemplateCopyName.value = String(
    packageForm.serviceName || selectedServiceTemplate.value?.name || '',
  ).trim()
  serviceTemplateCopyError.value = ''
  isServiceTemplateCopyOpen.value = true

  void nextTick(() => {
    serviceTemplateCopyInputRef.value?.focus()
    serviceTemplateCopyInputRef.value?.select()
  })
}

function closeServiceTemplateCopy() {
  if (isSavingServiceTemplate.value) {
    return
  }

  isServiceTemplateCopyOpen.value = false
  serviceTemplateCopyError.value = ''
}

async function saveServiceTemplateCopy() {
  const name = serviceTemplateCopyName.value.trim()

  if (!name) {
    serviceTemplateCopyError.value = '请输入服务模板名称'
    serviceTemplateCopyInputRef.value?.focus()
    return
  }

  const saved = await saveServiceTemplateFromPackage({
    createNew: true,
    name,
  })

  if (saved) {
    isServiceTemplateCopyOpen.value = false
    serviceTemplateCopyError.value = ''
    return
  }

  serviceTemplateCopyError.value = '保存失败，请查看活动日志'
}

function removeSelectedServiceTemplate() {
  if (!selectedServiceTemplate.value) {
    return
  }

  isServiceTemplateCopyOpen.value = false
  serviceTemplateCopyError.value = ''
  pendingTemplateDelete.value = {
    type: 'service',
    id: selectedServiceTemplateId.value,
    name: selectedServiceTemplate.value.name,
  }
}

function closeTemplateDeleteDialog() {
  if (!isDeletingTemplate.value) {
    pendingTemplateDelete.value = null
  }
}

async function confirmTemplateDelete() {
  const target = pendingTemplateDelete.value

  if (!target || isDeletingTemplate.value) {
    return
  }

  isDeletingTemplate.value = true

  try {
    if (target.type === 'dockerfile') {
      await deleteDockerfileTemplate(target.id)
    } else {
      await deleteServiceTemplate(target.id)
    }

    pendingTemplateDelete.value = null
  } finally {
    isDeletingTemplate.value = false
  }
}

watch(packageResult, (nextResult) => {
  if (nextResult) {
    showPackageToast()
    return
  }

  dismissPackageToast()
})

watch(
  () => packageForm.jarPath,
  () => {
    jarDropError.value = ''
  },
)

onMounted(() => {
  window.addEventListener('dragover', preventWindowFileDrop)
  window.addEventListener('drop', preventWindowFileDrop)
  loadServiceTemplates()
  loadDockerfileTemplates()
  refreshPackagePreview()
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', preventWindowFileDrop)
  window.removeEventListener('drop', preventWindowFileDrop)
  clearPackageToastTimer()
})
</script>

<template>
  <div ref="pageRef" class="package-view">
    <section class="package-console">
      <div class="package-body">
        <div class="package-fields">
          <div class="form-group">
            <p class="form-group-title">模板</p>

            <div class="field">
              <span>服务模板</span>
              <div class="template-picker-row service-template-row">
                <AppSelect
                  :model-value="selectedServiceTemplateId"
                  :options="serviceTemplateSelectOptions"
                  :disabled="!hasServiceTemplateBridge || isDeletingTemplate"
                  @change="changeServiceTemplate"
                />
                <button
                  type="button"
                  class="secondary-button compact-button"
                  :disabled="!hasServiceTemplateBridge || isSavingServiceTemplate || isDeletingTemplate"
                  @click="saveCurrentServiceTemplate"
                >
                  {{ selectedServiceTemplate ? '更新服务' : '保存服务' }}
                </button>
                <button
                  type="button"
                  class="secondary-button compact-button"
                  :disabled="!hasServiceTemplateBridge || isSavingServiceTemplate || isDeletingTemplate"
                  @click="openServiceTemplateCopy"
                >
                  另存
                </button>
                <button
                  v-if="selectedServiceTemplate"
                  type="button"
                  class="danger-button template-delete-trigger"
                  title="删除当前服务模板"
                  aria-label="删除当前服务模板"
                  :disabled="isSavingServiceTemplate || isDeletingTemplate"
                  @click="removeSelectedServiceTemplate"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </div>
              <InlineDeleteConfirm
                v-if="pendingTemplateDelete?.type === 'service'"
                :title="deleteDialogTitle"
                :message="deleteDialogMessage"
                :busy="isDeletingTemplate"
                @cancel="closeTemplateDeleteDialog"
                @confirm="confirmTemplateDelete"
              />
              <div v-if="isServiceTemplateCopyOpen" class="service-template-copy-form">
                <label class="field">
                  <span>新服务模板名称</span>
                  <input
                    ref="serviceTemplateCopyInputRef"
                    v-model="serviceTemplateCopyName"
                    type="text"
                    autocomplete="off"
                    placeholder="例如 aibox-s"
                    @input="serviceTemplateCopyError = ''"
                    @keydown.esc.stop="closeServiceTemplateCopy"
                    @keydown.enter.prevent="saveServiceTemplateCopy"
                  />
                  <small v-if="serviceTemplateCopyError" class="service-template-copy-error" role="alert">
                    {{ serviceTemplateCopyError }}
                  </small>
                </label>
                <div class="service-template-copy-actions">
                  <button
                    type="button"
                    class="secondary-button compact-button"
                    :disabled="isSavingServiceTemplate"
                    @click="closeServiceTemplateCopy"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="primary-button compact-button"
                    :disabled="isSavingServiceTemplate"
                    @click="saveServiceTemplateCopy"
                  >
                    {{ isSavingServiceTemplate ? '保存中...' : '保存副本' }}
                  </button>
                </div>
              </div>
              <small class="template-description">
                {{ selectedServiceTemplateSummary }}
              </small>
            </div>

            <div class="field">
              <span>Dockerfile 模板</span>
              <div class="template-picker-row">
                <AppSelect
                  :model-value="packageForm.dockerfileTemplateId"
                  :options="dockerfileSelectOptions"
                  :disabled="isDeletingTemplate"
                  @change="changeDockerfileTemplate"
                />
                <button
                  type="button"
                  class="secondary-button"
                  :disabled="isDeletingTemplate"
                  @click="openDockerfileImport"
                >
                  导入 Dockerfile
                </button>
                <button
                  v-if="canDeleteSelectedCustomTemplate"
                  type="button"
                  class="danger-button template-delete-trigger"
                  title="删除当前 Dockerfile 模板"
                  aria-label="删除当前 Dockerfile 模板"
                  :disabled="isDeletingTemplate"
                  @click="removeSelectedDockerfileTemplate"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </div>
              <small class="template-description">
                {{ selectedTemplateSourceLabel }} · {{ selectedTemplateDescription || '按当前表单生成 Dockerfile' }}
              </small>
              <InlineDeleteConfirm
                v-if="pendingTemplateDelete?.type === 'dockerfile'"
                :title="deleteDialogTitle"
                :message="deleteDialogMessage"
                :busy="isDeletingTemplate"
                @cancel="closeTemplateDeleteDialog"
                @confirm="confirmTemplateDelete"
              />
            </div>
          </div>

          <div class="form-group">
            <p class="form-group-title">构建输入</p>

            <div class="field">
              <span>Jar 包</span>
              <button
                type="button"
                class="file-dropzone"
                :class="{
                  'is-dragging': isJarDragActive,
                  'has-file': hasJarFile,
                  'has-error': jarDropError,
                }"
                :disabled="!hasElectronBridge || isBuildingPackage"
                :aria-label="hasJarFile ? '替换 Jar 文件：' + jarFileName : '选择或拖入 Jar 文件'"
                @click="chooseJarFile"
                @dragenter.prevent.stop="handleJarDragEnter"
                @dragover.prevent.stop="handleJarDragOver"
                @dragleave.prevent.stop="handleJarDragLeave"
                @drop.prevent.stop="handleJarDrop"
              >
                <div class="file-dropzone-icon" aria-hidden="true">
                  <UploadCloud v-if="isJarDragActive" :size="19" />
                  <FileArchive v-else :size="19" />
                </div>
                <div class="file-dropzone-copy">
                  <strong>
                    {{ isJarDragActive ? '释放以使用这个 Jar' : jarFileName || '拖入 Jar 包' }}
                  </strong>
                  <small :title="packageForm.jarPath">
                    {{
                      isJarDragActive
                        ? '仅接收单个 .jar 文件'
                        : packageForm.jarPath || '也可以点击此区域从本机选择'
                    }}
                  </small>
                </div>
                <div class="file-dropzone-action" aria-hidden="true">
                  <Upload :size="14" />
                  <b>{{ hasJarFile ? '替换' : '选择' }}</b>
                </div>
              </button>
              <small v-if="jarDropError" class="file-dropzone-message error" role="alert">
                {{ jarDropError }}
              </small>
              <small v-else class="file-dropzone-message">
                {{ hasElectronBridge ? '支持拖放或点击选择 .jar 文件' : '请通过 Electron 模式选择本地文件' }}
              </small>
            </div>

            <div class="field-row">
              <label class="field fill">
                <span>服务名</span>
                <input
                  :value="packageForm.serviceName"
                  type="text"
                  placeholder="openhsd-server"
                  @input="updatePackageForm({ serviceName: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>服务版本</span>
                <input
                  :value="packageForm.serviceVersion"
                  type="text"
                  placeholder="1.0.0"
                  @input="updatePackageForm({ serviceVersion: $event.target.value })"
                />
              </label>
            </div>
          </div>

          <div class="form-group">
            <div class="form-group-head">
              <p class="form-group-title">运行环境</p>
              <label class="checkbox-field">
                <input
                  :checked="packageForm.useNonRootUser"
                  type="checkbox"
                  @change="updatePackageForm({ useNonRootUser: $event.target.checked })"
                />
                <span>非 root 运行</span>
              </label>
            </div>

            <div class="field">
              <span>Java 版本</span>
              <div class="version-picker">
                <button
                  v-for="version in javaVersionOptions"
                  :key="version"
                  class="version-chip"
                  type="button"
                  :class="{ selected: packageForm.javaVersion === version }"
                  @click="updateJavaVersion(version)"
                >
                  {{ version }}
                </button>
                <input
                  class="version-input"
                  :value="packageForm.javaVersion"
                  type="text"
                  placeholder="自定义"
                  @input="updateJavaVersion($event.target.value)"
                />
              </div>
            </div>

            <div class="field-row">
              <label class="field fill">
                <span>启动端口</span>
                <input
                  :value="packageForm.servicePort"
                  type="number"
                  min="1"
                  max="65535"
                  @input="updatePackageForm({ servicePort: Number($event.target.value) })"
                />
              </label>
              <label v-if="packageForm.useNonRootUser" class="field fill">
                <span>运行用户</span>
                <input
                  :value="packageForm.appUser"
                  type="text"
                  placeholder="spring"
                  @input="updatePackageForm({ appUser: $event.target.value })"
                />
              </label>
            </div>

            <label class="field">
              <span>基础镜像</span>
              <input
                :value="packageForm.baseImage"
                type="text"
                @input="updatePackageForm({ baseImage: $event.target.value })"
              />
            </label>

            <label class="field">
              <span>JVM 参数</span>
              <input
                :value="packageForm.javaOpts"
                type="text"
                @input="updatePackageForm({ javaOpts: $event.target.value })"
              />
            </label>
          </div>
        </div>

        <div class="package-preview">
          <div class="preview-identity" :class="{ empty: !packagePreview?.imageRef }">
            <div class="preview-identity-main">
              <span class="preview-identity-label">镜像引用</span>
              <strong :title="packagePreview?.imageRef">{{ packagePreview?.imageRef || '等待生成镜像信息' }}</strong>
            </div>
            <CopyButton
              v-if="packagePreview?.imageRef"
              :value="packagePreview.imageRef"
              label="复制镜像引用"
            />
          </div>

          <div class="preview-groups">
            <section class="preview-group">
              <p class="preview-group-title">镜像</p>
              <dl class="preview-list">
                <div class="preview-row">
                  <dt>镜像名</dt>
                  <dd :title="packagePreview?.imageName">{{ packagePreview?.imageName || '-' }}</dd>
                </div>
                <div class="preview-row">
                  <dt>Tag</dt>
                  <dd>{{ packagePreview?.imageTag || '-' }}</dd>
                </div>
                <div class="preview-row">
                  <dt>Jar 文件</dt>
                  <dd :title="packagePreview?.jarName">{{ packagePreview?.jarName || '-' }}</dd>
                </div>
              </dl>
            </section>

            <section class="preview-group">
              <p class="preview-group-title">运行环境</p>
              <dl class="preview-list">
                <div class="preview-row">
                  <dt>模板</dt>
                  <dd>{{ packagePreview?.dockerfileTemplateName || packageForm.dockerfileTemplateName }}</dd>
                </div>
                <div class="preview-row">
                  <dt>基础镜像</dt>
                  <dd class="mono" :title="packagePreview?.baseImage || packageForm.baseImage">
                    {{ packagePreview?.baseImage || packageForm.baseImage }}
                  </dd>
                </div>
                <div class="preview-row">
                  <dt>Java</dt>
                  <dd>{{ packagePreview?.javaVersion || packageForm.javaVersion }}</dd>
                </div>
                <div class="preview-row">
                  <dt>运行用户</dt>
                  <dd>{{ previewRunUser }}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section class="preview-group preview-dockerfile">
            <div class="preview-group-head">
              <p class="preview-group-title">Dockerfile</p>
              <CopyButton
                v-if="previewLines.length"
                :value="previewLines.join('\n')"
                label="复制 Dockerfile"
              />
            </div>
            <div class="command-panel">
              <pre><code>{{ previewLines.join('\n') || '等待选择 Jar 文件后生成预览' }}</code></pre>
            </div>
          </section>

          <RunProgress
            v-if="isBuildingPackage"
            :active="true"
            :stages="PACKAGE_STAGES"
            running-text="正在生成镜像包…"
          />
        </div>
      </div>

      <footer class="console-foot">
        <div class="console-status">
          <span class="state-pill" :class="buildTone">{{ buildLabel }}</span>
          <p class="console-hint" :title="packageHint">{{ packageHint }}</p>
        </div>

        <div class="console-actions">
          <button class="secondary-button" type="button" @click="refreshPackagePreview">刷新预览</button>
          <button class="secondary-button" type="button" @click="openImagePackageDirectory">打开目录</button>
          <button class="secondary-button" type="button" @click="emit('open-logs')">查看日志</button>
          <button
            class="primary-button"
            type="button"
            :class="{ 'is-loading': isBuildingPackage }"
            :aria-busy="isBuildingPackage"
            :disabled="!canBuildImagePackage || isBuildingPackage"
            @click="buildImagePackage"
          >
            <span v-if="isBuildingPackage" class="btn-spinner" aria-hidden="true"></span>
            {{ isBuildingPackage ? '生成中…' : '生成镜像包' }}
          </button>
        </div>
      </footer>
    </section>

    <transition name="package-toast">
      <aside
        v-if="packageResult && isPackageToastVisible"
        class="package-toast"
        :class="{ failed: !packageResult.ok }"
        role="status"
      >
        <div class="package-toast-main">
          <span class="package-toast-dot"></span>
          <div class="package-toast-copy">
            <p class="eyebrow">Build Result</p>
            <strong>{{ packageResult.message }}</strong>
            <div class="package-toast-meta">
              <span
                v-for="item in packageResultStats"
                :key="item.label"
                class="package-toast-stat"
                :class="{ output: item.label === '输出' }"
                :title="item.value"
              >
                <small>{{ item.label }}</small>
                <b>{{ item.value }}</b>
              </span>
            </div>
          </div>
        </div>
        <div class="package-toast-actions">
          <button class="secondary-button" type="button" @click="openPackageResultDirectory">
            打开目录
          </button>
          <button class="toast-close-button" type="button" @click="dismissPackageToast">
            关闭
          </button>
        </div>
      </aside>
    </transition>

    <div v-if="isDockerfileImportOpen" class="dockerfile-modal" role="dialog" aria-modal="true">
      <section class="dockerfile-modal-card">
        <header class="dockerfile-modal-header">
          <div>
            <p class="eyebrow">Dockerfile Import</p>
            <h3>导入识别</h3>
          </div>
          <button class="secondary-button" type="button" @click="closeDockerfileImport">
            关闭
          </button>
        </header>

        <div class="dockerfile-modal-body">
          <div class="dockerfile-import-main">
            <label class="field">
              <span>模板名称</span>
              <input
                v-model="dockerfileTemplateName"
                type="text"
                placeholder="例如 hsdclaw JavaCPP 模板"
              />
            </label>

            <label class="field">
              <span>说明</span>
              <input
                v-model="dockerfileTemplateDescription"
                type="text"
                placeholder="可选，用来区分项目或运行环境"
              />
            </label>

            <label class="field dockerfile-import-text">
              <span>Dockerfile 内容</span>
              <textarea
                v-model="dockerfileImportText"
                class="dockerfile-import-textarea"
                spellcheck="false"
                placeholder="在这里粘贴你的 Dockerfile"
              ></textarea>
            </label>
          </div>

          <aside class="dockerfile-import-summary">
            <p class="preview-group-title">识别结果</p>
            <div v-if="dockerfileImportSummary.length" class="import-summary-list">
              <div
                v-for="item in dockerfileImportSummary"
                :key="item.label"
                class="import-summary-item"
                :title="item.value"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
            <p v-else class="command-hint">
              粘贴 Dockerfile 后，会自动识别基础镜像、端口、运行用户和 JVM 参数。
            </p>
          </aside>
        </div>

        <footer class="dockerfile-modal-footer">
          <button
            class="secondary-button"
            type="button"
            :disabled="!dockerfileImportText.trim() || isSavingDockerfileTemplate"
            @click="saveDockerfileImport"
          >
            {{ isSavingDockerfileTemplate ? '保存中...' : '保存为模板' }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="!dockerfileImportText.trim()"
            @click="applyDockerfileImport"
          >
            识别并应用
          </button>
        </footer>
      </section>
    </div>

  </div>
</template>
