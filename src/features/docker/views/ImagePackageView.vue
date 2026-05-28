<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { buildBaseImage, parseDockerfileText } from '../../../shared/dockerfileTemplates.js'

// 本地镜像包生成页，负责展示 Jar -> Docker 镜像压缩包的完整流程。
const {
  packageForm,
  packagePreview,
  packageResult,
  dockerfileTemplateOptions,
  selectedDockerfileTemplate,
  isBuildingPackage,
  isSavingDockerfileTemplate,
  canBuildImagePackage,
  packageHint,
  updatePackageForm,
  loadDockerfileTemplates,
  selectDockerfileTemplate,
  applyImportedDockerfileTemplate,
  saveDockerfileTemplate,
  deleteDockerfileTemplate,
  selectJarFile,
  refreshPackagePreview,
  buildImagePackage,
  openImagePackageDirectory,
} = useWorkspaceSession()

const previewLines = computed(() => {
  return packagePreview.value?.dockerfileText?.split('\n') || []
})

const isDockerfileImportOpen = ref(false)
const dockerfileImportText = ref('')
const dockerfileTemplateName = ref('')
const dockerfileTemplateDescription = ref('')
const isPackageToastVisible = ref(false)
let packageToastTimer = null

const builtinTemplateOptions = computed(() => {
  return dockerfileTemplateOptions.value.filter((template) => template.sourceType === 'builtin')
})

const customTemplateOptions = computed(() => {
  return dockerfileTemplateOptions.value.filter((template) => template.sourceType !== 'builtin')
})

const selectedTemplateDescription = computed(() => {
  return selectedDockerfileTemplate.value?.description || packageForm.dockerfileTemplateDescription || ''
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

watch(packageResult, (nextResult) => {
  if (nextResult) {
    showPackageToast()
    return
  }

  dismissPackageToast()
})

onMounted(() => {
  loadDockerfileTemplates()
  refreshPackagePreview()
})

onBeforeUnmount(() => {
  clearPackageToastTimer()
})
</script>

<template>
  <div class="package-view">
    <section class="panel package-panel package-form-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Docker Package</p>
          <h3>Jar 打镜像包</h3>
        </div>
        <span class="state-pill" :class="{ success: packageResult?.ok, failed: packageResult && !packageResult.ok }">
          {{ isBuildingPackage ? 'Building' : packageResult?.status || 'Idle' }}
        </span>
      </div>

      <div class="package-form-body">
        <div class="package-fields">
          <div class="field">
            <span>Dockerfile 模板</span>
            <div class="template-picker-row">
              <select
                class="select-input"
                :value="packageForm.dockerfileTemplateId"
                @change="selectDockerfileTemplate($event.target.value)"
              >
                <optgroup label="内置模板">
                  <option
                    v-for="template in builtinTemplateOptions"
                    :key="template.id"
                    :value="template.id"
                  >
                    {{ template.name }}
                  </option>
                </optgroup>
                <optgroup v-if="customTemplateOptions.length" label="自定义模板">
                  <option
                    v-for="template in customTemplateOptions"
                    :key="template.id"
                    :value="template.id"
                  >
                    {{ template.name }}
                  </option>
                </optgroup>
              </select>
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
          <button class="primary-button" type="button" :disabled="!canBuildImagePackage || isBuildingPackage" @click="buildImagePackage">
            {{ isBuildingPackage ? '生成中...' : '生成镜像包' }}
          </button>
          <button class="secondary-button" type="button" @click="refreshPackagePreview">刷新预览</button>
          <button class="secondary-button" type="button" @click="openImagePackageDirectory">打开目录</button>
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
        <span class="state-pill">{{ packagePreview?.imageRef || 'Pending' }}</span>
      </div>

      <dl class="package-meta-grid">
        <div>
          <dt>镜像名</dt>
          <dd>{{ packagePreview?.imageName || '-' }}</dd>
        </div>
        <div>
          <dt>Tag</dt>
          <dd>{{ packagePreview?.imageTag || '-' }}</dd>
        </div>
        <div>
          <dt>镜像引用</dt>
          <dd>{{ packagePreview?.imageRef || '-' }}</dd>
        </div>
        <div>
          <dt>Jar 文件</dt>
          <dd>{{ packagePreview?.jarName || '-' }}</dd>
        </div>
        <div>
          <dt>模板</dt>
          <dd>{{ packagePreview?.dockerfileTemplateName || packageForm.dockerfileTemplateName }}</dd>
        </div>
        <div>
          <dt>基础镜像</dt>
          <dd>{{ packagePreview?.baseImage || packageForm.baseImage }}</dd>
        </div>
        <div>
          <dt>Java</dt>
          <dd>{{ packagePreview?.javaVersion || packageForm.javaVersion }}</dd>
        </div>
        <div>
          <dt>运行用户</dt>
          <dd>{{ packagePreview?.useNonRootUser ? packagePreview?.appUser : 'root' }}</dd>
        </div>
        <div class="wide">
          <dt>Dockerfile</dt>
          <dd class="dockerfile-preview">
            <pre><code>{{ previewLines.join('\n') || '等待选择 Jar 文件后生成预览' }}</code></pre>
          </dd>
        </div>
      </dl>

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
