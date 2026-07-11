<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import AppSelect from '../../../components/ui/AppSelect.vue'
import { buildBaseImage, parseDockerfileText } from '../../../shared/dockerfileTemplates.js'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'
import RunProgress from '../../workspace/components/RunProgress.vue'
import CopyButton from '../../../components/ui/CopyButton.vue'

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
usePageEntrance(pageRef)

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

async function removeSelectedDockerfileTemplate() {
  if (!canDeleteSelectedCustomTemplate.value) {
    return
  }

  const confirmed = window.confirm(`确定删除模板「${packageForm.dockerfileTemplateName}」吗？`)

  if (!confirmed) {
    return
  }

  await deleteDockerfileTemplate(packageForm.dockerfileTemplateId)
}

async function saveCurrentServiceTemplate() {
  await saveServiceTemplateFromPackage()
}

async function createServiceTemplateCopy() {
  const name = window.prompt('服务模板名称', packageForm.serviceName || selectedServiceTemplate.value?.name || '')

  if (name === null) {
    return
  }

  await saveServiceTemplateFromPackage({
    createNew: true,
    name,
  })
}

async function removeSelectedServiceTemplate() {
  if (!selectedServiceTemplate.value) {
    return
  }

  const confirmed = window.confirm(`确定删除服务模板「${selectedServiceTemplate.value.name}」吗？`)

  if (!confirmed) {
    return
  }

  await deleteServiceTemplate(selectedServiceTemplateId.value)
}

watch(packageResult, (nextResult) => {
  if (nextResult) {
    showPackageToast()
    return
  }

  dismissPackageToast()
})

onMounted(() => {
  loadServiceTemplates()
  loadDockerfileTemplates()
  refreshPackagePreview()
})

onBeforeUnmount(() => {
  clearPackageToastTimer()
})
</script>

<template>
  <div ref="pageRef" class="package-view">
    <section class="panel package-panel package-form-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Docker Package</p>
          <h3>Jar 打镜像包</h3>
        </div>
        <span class="state-pill" :class="{ success: packageResult?.ok && !isBuildingPackage, failed: packageResult && !packageResult.ok && !isBuildingPackage, running: isBuildingPackage }">
          {{ isBuildingPackage ? 'Building' : packageResult?.status || 'Idle' }}
        </span>
      </div>

      <div class="package-form-body">
        <div class="package-fields">
          <div class="field">
            <span>服务模板</span>
            <div class="template-picker-row service-template-row">
              <AppSelect
                :model-value="selectedServiceTemplateId"
                :options="serviceTemplateSelectOptions"
                :disabled="!hasServiceTemplateBridge"
                @change="selectServiceTemplate($event, 'package')"
              />
              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="!hasServiceTemplateBridge || isSavingServiceTemplate"
                @click="saveCurrentServiceTemplate"
              >
                {{ selectedServiceTemplate ? '更新服务' : '保存服务' }}
              </button>
              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="!hasServiceTemplateBridge || isSavingServiceTemplate"
                @click="createServiceTemplateCopy"
              >
                另存
              </button>
              <button
                v-if="selectedServiceTemplate"
                type="button"
                class="danger-button compact-button"
                :disabled="isSavingServiceTemplate"
                @click="removeSelectedServiceTemplate"
              >
                删除
              </button>
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
                @change="selectDockerfileTemplate"
              />
              <button type="button" class="secondary-button" @click="openDockerfileImport">
                导入 Dockerfile
              </button>
              <button
                v-if="canDeleteSelectedCustomTemplate"
                type="button"
                class="danger-button compact-button"
                @click="removeSelectedDockerfileTemplate"
              >
                删除模板
              </button>
            </div>
            <small class="template-description">
              {{ selectedTemplateSourceLabel }} · {{ selectedTemplateDescription || '按当前表单生成 Dockerfile' }}
            </small>
          </div>

          <div class="field">
            <span>Jar 包</span>
            <div class="file-input-row">
              <input
                :value="packageForm.jarPath"
                type="text"
                placeholder="请选择本地 jar 文件"
                readonly
              />
              <button type="button" class="secondary-button" @click="selectJarFile">选择 Jar</button>
            </div>
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

          <div class="field-row compact-row">
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

          <section class="advanced-box">
            <div class="advanced-header">
              <div>
                <p class="eyebrow">Advanced</p>
                <h3>运行环境</h3>
              </div>
              <label class="checkbox-field">
                <input
                  :checked="packageForm.useNonRootUser"
                  type="checkbox"
                  @change="updatePackageForm({ useNonRootUser: $event.target.checked })"
                />
                <span>非 root</span>
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

            <div class="advanced-two-lines">
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
          </section>
        </div>

        <div class="package-actions">
        <div class="panel-actions">
          <button class="primary-button" type="button" :class="{ 'is-loading': isBuildingPackage }" :aria-busy="isBuildingPackage" :disabled="!canBuildImagePackage || isBuildingPackage" @click="buildImagePackage">
            <span v-if="isBuildingPackage" class="btn-spinner" aria-hidden="true"></span>
            {{ isBuildingPackage ? '生成中…' : '生成镜像包' }}
          </button>
          <button class="secondary-button" type="button" @click="refreshPackagePreview">刷新预览</button>
          <button class="secondary-button" type="button" @click="openImagePackageDirectory">打开目录</button>
          <button class="secondary-button" type="button" @click="emit('open-logs')">查看日志</button>
        </div>

        <p class="command-hint">{{ packageHint }}</p>
      </div>
      </div>
    </section>

    <section class="panel package-panel package-preview-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Configuration Preview</p>
          <h3>配置信息预览</h3>
        </div>
        <span class="state-pill">{{ packagePreview ? '已就绪' : '待生成' }}</span>
      </div>

      <div class="package-preview-body">
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
      </div>

      <RunProgress
        v-if="isBuildingPackage"
        :active="true"
        :stages="PACKAGE_STAGES"
        running-text="正在生成镜像包…"
      />
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
            <div>
              <p class="eyebrow">Recognized</p>
              <h3>识别结果</h3>
            </div>
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
            class="primary-button"
            type="button"
            :disabled="!dockerfileImportText.trim()"
            @click="applyDockerfileImport"
          >
            识别并应用
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="!dockerfileImportText.trim() || isSavingDockerfileTemplate"
            @click="saveDockerfileImport"
          >
            {{ isSavingDockerfileTemplate ? '保存中...' : '保存为模板' }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>
