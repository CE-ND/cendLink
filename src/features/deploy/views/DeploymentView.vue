<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

// 远程部署页：选择镜像包、编辑部署参数、实时预览 docker run 并执行部署。
const {
  savedServers,
  activeServerId,
  deployments,
  deployForm,
  deployPreview,
  deployResult,
  isDeploying,
  canDeploy,
  deployHint,
  hasDeploymentBridge,
  updateDeployForm,
  selectDeployPackageFile,
  refreshDeployPreview,
  runDeployment,
} = useWorkspaceSession()

const emit = defineEmits(['open-logs'])

const selectedServer = computed(() => {
  return savedServers.value.find((item) => item.id === activeServerId.value) || null
})

const environmentLines = computed(() => {
  return deployPreview.value?.envVars?.map((item) => `${item.key}=${item.value}`) || []
})

const mountLines = computed(() => {
  return deployPreview.value?.mounts?.map((item) => `${item.hostPath} -> ${item.containerPath}`) || []
})

const deployFormCard = ref(null)
const isAdvancedOpen = ref(false)
let deployGsapContext = null

const packageHistory = computed(() => {
  return deployments.value.filter((item) => item.status === 'package_success')
})

const recentPackages = computed(() => {
  return packageHistory.value.slice(0, 5)
})

const selectedPackageRecord = computed(() => {
  return packageHistory.value.find((item) => item.deployPath === deployForm.localPackagePath) || null
})

const currentPackageFileName = computed(() => {
  return getFileName(deployForm.localPackagePath)
})

const currentPackageSource = computed(() => {
  if (!deployForm.localPackagePath) {
    return '等待选择'
  }

  return selectedPackageRecord.value ? '来自打包记录' : '手动选择'
})

const currentImageRef = computed(() => {
  return deployPreview.value?.imageRef || [deployForm.imageName, deployForm.imageTag].filter(Boolean).join(':') || '-'
})

const targetServerLabel = computed(() => {
  if (!selectedServer.value) {
    return '未选择服务器'
  }

  return `${selectedServer.value.name} · ${selectedServer.value.host}:${selectedServer.value.port}`
})

const deploySummaryItems = computed(() => {
  return [
    {
      label: '目标',
      value: selectedServer.value ? selectedServer.value.name : '未选择',
    },
    {
      label: '端口',
      value: `${deployForm.hostPort || '-'}:${deployForm.containerPort || '-'}`,
    },
    {
      label: '容器',
      value: deployForm.containerName || '-',
    },
  ]
})

const selectedPackageMeta = computed(() => {
  const metadata = selectedPackageRecord.value?.metadata || {}

  return [
    {
      label: '镜像',
      value: metadata.imageRef || currentImageRef.value,
    },
    {
      label: '版本',
      value: metadata.serviceVersion || deployForm.serviceVersion || '-',
    },
    {
      label: '端口',
      value: metadata.servicePort || deployForm.containerPort || '-',
    },
  ]
})

function applyHistoryPackage(item) {
  const metadata = item.metadata || {}
  const imageRef = String(metadata.imageRef || item.projectId || '')
  const [imageName = deployForm.imageName, imageTag = deployForm.imageTag] = imageRef.split(':')
  const serviceName = String(metadata.serviceName || imageName || deployForm.serviceName).replace(/[^a-zA-Z0-9._-]+/g, '_')

  updateDeployForm({
    packageSourceType: 'history',
    localPackagePath: item.deployPath || '',
    serviceName,
    serviceVersion: String(metadata.serviceVersion || imageTag || deployForm.serviceVersion),
    imageName: imageName || deployForm.imageName,
    imageTag: imageTag || deployForm.imageTag,
    containerName: serviceName || deployForm.containerName,
    containerPort: Number(metadata.servicePort || deployForm.containerPort || 8080),
  })
}

function getFileName(filePath) {
  const value = String(filePath || '').trim()

  if (!value) {
    return ''
  }

  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

function getPackageTitle(item) {
  const metadata = item?.metadata || {}
  return metadata.imageRef || item?.projectId || metadata.serviceName || item?.artifactName || '镜像包'
}

function getPackageSubtitle(item) {
  const metadata = item?.metadata || {}
  const version = metadata.serviceVersion ? `版本 ${metadata.serviceVersion}` : '未记录版本'
  const fileName = getFileName(item?.deployPath || '')

  return [version, fileName].filter(Boolean).join(' · ')
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

function toggleAdvancedOpen() {
  isAdvancedOpen.value = !isAdvancedOpen.value
}

function animateSummary() {
  const selector = deployGsapContext?.selector

  if (!selector) {
    return
  }

  gsap.fromTo(
    selector('.deploy-package-summary'),
    { autoAlpha: 0.82, y: 4 },
    { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power3.out', overwrite: 'auto' },
  )
}

function animateActivePackage() {
  const activeItem = deployFormCard.value?.querySelector('.deploy-history-item.active')

  if (!activeItem) {
    return
  }

  gsap.fromTo(
    activeItem,
    { scale: 0.985 },
    { scale: 1, duration: 0.18, ease: 'power3.out', overwrite: 'auto', clearProps: 'transform' },
  )
}

onMounted(() => {
  refreshDeployPreview()

  if (!deployFormCard.value) {
    return
  }

  deployGsapContext = gsap.context(() => {
    gsap.from('.deploy-package-summary', {
      autoAlpha: 0,
      y: 8,
      duration: 0.24,
      ease: 'power3.out',
    })

    gsap.from('.deploy-section', {
      autoAlpha: 0,
      y: 8,
      duration: 0.24,
      ease: 'power3.out',
      stagger: 0.035,
      delay: 0.04,
    })
  }, deployFormCard.value)
})

onUnmounted(() => {
  deployGsapContext?.revert()
})

watch(
  () => [
    deployForm.localPackagePath,
    deployForm.imageName,
    deployForm.imageTag,
    deployForm.hostPort,
    deployForm.containerPort,
    deployForm.containerName,
    activeServerId.value,
  ],
  async () => {
    await nextTick()
    animateSummary()
    animateActivePackage()
  },
  { flush: 'post' },
)

watch(isAdvancedOpen, async (isOpen) => {
  await nextTick()

  if (!isOpen) {
    return
  }

  const selector = deployGsapContext?.selector

  if (!selector) {
    return
  }

  gsap.fromTo(
    selector('.deploy-advanced-body .field, .deploy-advanced-body .field-row'),
    { autoAlpha: 0, y: 6 },
    { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power3.out', stagger: 0.025, overwrite: 'auto' },
  )
})
</script>

<template>
  <div class="deploy-view">
    <section ref="deployFormCard" class="panel deploy-panel deploy-form-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Remote Deploy</p>
          <h3>镜像包部署</h3>
        </div>
        <span class="state-pill" :class="{ success: deployResult?.ok, failed: deployResult && !deployResult.ok }">
          {{ isDeploying ? 'Deploying' : deployResult?.status || 'Idle' }}
        </span>
      </div>

      <div class="deploy-form-body">
        <div class="deploy-fields">
          <div class="deploy-package-summary" :class="{ empty: !deployForm.localPackagePath }">
            <div class="deploy-summary-head">
              <span class="field-prompt">当前镜像包</span>
              <span class="deploy-source-pill">{{ currentPackageSource }}</span>
            </div>

            <div class="deploy-summary-main">
              <strong :title="currentPackageFileName">{{ currentPackageFileName || '还没有选择镜像包' }}</strong>
              <small :title="deployForm.localPackagePath">
                {{ deployForm.localPackagePath || '选择 tar.gz，或从最近打包记录带入部署参数' }}
              </small>
            </div>

            <div class="deploy-summary-footer">
              <div class="deploy-summary-metrics">
                <span>
                  <small>镜像</small>
                  <b :title="currentImageRef">{{ currentImageRef }}</b>
                </span>
                <span>
                  <small>端口</small>
                  <b>{{ deployForm.hostPort || '-' }} -> {{ deployForm.containerPort || '-' }}</b>
                </span>
              </div>

              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="!hasDeploymentBridge"
                @click="selectDeployPackageFile"
              >
                更换
              </button>
            </div>
          </div>

          <section class="deploy-section deploy-target-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">目标与风险点</span>
                <strong>部署前确认</strong>
              </div>
            </div>

            <label class="field">
              <span>目标服务器</span>
              <input :value="targetServerLabel" type="text" readonly />
            </label>

            <div class="deploy-confirm-strip">
              <span v-for="item in deploySummaryItems" :key="item.label">
                <small>{{ item.label }}</small>
                <b>{{ item.value }}</b>
              </span>
            </div>
          </section>

          <section v-if="recentPackages.length" class="deploy-section deploy-history-picks">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">最近镜像包</span>
                <strong>选择已有打包结果</strong>
              </div>
              <span class="deploy-count-pill">{{ packageHistory.length }} 条</span>
            </div>

            <div class="deploy-history-list">
              <button
                v-for="item in recentPackages"
                :key="item.id"
                type="button"
                class="deploy-history-item"
                :class="{ active: deployForm.localPackagePath === item.deployPath }"
                @click="applyHistoryPackage(item)"
              >
                <span class="deploy-history-copy">
                  <strong>{{ getPackageTitle(item) }}</strong>
                  <small :title="item.deployPath">{{ getPackageSubtitle(item) }}</small>
                </span>
                <span class="deploy-history-side">
                  <small>{{ formatRecordTime(item.createdAt) }}</small>
                  <b>{{ deployForm.localPackagePath === item.deployPath ? '已选' : '选择' }}</b>
                </span>
              </button>
            </div>
          </section>

          <section class="deploy-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">基础信息</span>
                <strong>服务与镜像</strong>
              </div>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>服务名</span>
                <input
                  :value="deployForm.serviceName"
                  type="text"
                  @input="updateDeployForm({ serviceName: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>版本</span>
                <input
                  :value="deployForm.serviceVersion"
                  type="text"
                  @input="updateDeployForm({ serviceVersion: $event.target.value, imageTag: $event.target.value })"
                />
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>镜像名</span>
                <input
                  :value="deployForm.imageName"
                  type="text"
                  @input="updateDeployForm({ imageName: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>镜像 Tag</span>
                <input
                  :value="deployForm.imageTag"
                  type="text"
                  @input="updateDeployForm({ imageTag: $event.target.value })"
                />
              </label>
            </div>

            <div class="deploy-mini-meta">
              <span v-for="item in selectedPackageMeta" :key="item.label">
                <small>{{ item.label }}</small>
                <b>{{ item.value }}</b>
              </span>
            </div>
          </section>

          <section class="deploy-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">容器运行</span>
                <strong>名称、端口与重启</strong>
              </div>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>容器名</span>
                <input
                  :value="deployForm.containerName"
                  type="text"
                  @input="updateDeployForm({ containerName: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>重启策略</span>
                <select
                  :value="deployForm.restartPolicy"
                  class="select-input"
                  @change="updateDeployForm({ restartPolicy: $event.target.value })"
                >
                  <option value="unless-stopped">unless-stopped</option>
                  <option value="always">always</option>
                  <option value="on-failure">on-failure</option>
                  <option value="no">no</option>
                </select>
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>宿主机端口</span>
                <input
                  :value="deployForm.hostPort"
                  type="number"
                  min="1"
                  max="65535"
                  @input="updateDeployForm({ hostPort: Number($event.target.value) })"
                />
              </label>
              <label class="field fill">
                <span>容器端口</span>
                <input
                  :value="deployForm.containerPort"
                  type="number"
                  min="1"
                  max="65535"
                  @input="updateDeployForm({ containerPort: Number($event.target.value) })"
                />
              </label>
            </div>
          </section>

          <section class="deploy-section">
            <div class="deploy-section-header">
              <div>
                <span class="field-prompt">服务器目录</span>
                <strong>上传与发布位置</strong>
              </div>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>发布根目录</span>
                <input
                  :value="deployForm.remoteBaseDir"
                  type="text"
                  @input="updateDeployForm({ remoteBaseDir: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>上传目录</span>
                <input
                  :value="deployForm.remotePackageDir"
                  type="text"
                  @input="updateDeployForm({ remotePackageDir: $event.target.value })"
                />
              </label>
            </div>
          </section>

          <section class="deploy-section deploy-advanced-section" :class="{ expanded: isAdvancedOpen }">
            <button type="button" class="deploy-section-header advanced-toggle" @click="toggleAdvancedOpen">
              <span>
                <span class="field-prompt">高级选项</span>
                <strong>冲突策略、权限与环境变量</strong>
              </span>
              <b>{{ isAdvancedOpen ? '收起' : '展开' }}</b>
            </button>

            <transition name="deploy-collapse">
              <div v-if="isAdvancedOpen" class="deploy-advanced-body">
                <div class="field-row compact-row">
                  <label class="field fill">
                    <span>旧容器策略</span>
                    <select
                      :value="deployForm.containerConflictStrategy"
                      class="select-input"
                      @change="updateDeployForm({ containerConflictStrategy: $event.target.value })"
                    >
                      <option value="auto">自动替换</option>
                      <option value="abort">发现冲突终止</option>
                    </select>
                  </label>
                  <label class="field fill">
                    <span>旧镜像策略</span>
                    <select
                      :value="deployForm.imageCleanupStrategy"
                      class="select-input"
                      @change="updateDeployForm({ imageCleanupStrategy: $event.target.value })"
                    >
                      <option value="keep">保留旧镜像</option>
                      <option value="auto">自动清理</option>
                    </select>
                  </label>
                </div>

                <div class="field-row compact-row">
                  <label class="field fill">
                    <span>目录权限策略</span>
                    <select
                      :value="deployForm.directoryPermissionMode"
                      class="select-input"
                      @change="updateDeployForm({ directoryPermissionMode: $event.target.value })"
                    >
                      <option value="none">不处理</option>
                      <option value="chmod777">兼容模式 chmod 777</option>
                    </select>
                  </label>
                  <label class="field fill">
                    <span>额外参数</span>
                    <input
                      :value="deployForm.extraArgs"
                      type="text"
                      placeholder="例如 --network host"
                      @input="updateDeployForm({ extraArgs: $event.target.value })"
                    />
                  </label>
                </div>

                <label class="field">
                  <span>环境变量</span>
                  <textarea
                    :value="deployForm.envText"
                    class="deploy-textarea"
                    rows="4"
                    placeholder="KEY=VALUE，每行一个"
                    @input="updateDeployForm({ envText: $event.target.value })"
                  ></textarea>
                </label>
              </div>
            </transition>
          </section>
        </div>

        <div class="package-actions deploy-actions">
          <div class="panel-actions">
            <button class="primary-button" type="button" :disabled="!canDeploy || isDeploying" @click="runDeployment">
              {{ isDeploying ? '部署中...' : '开始部署' }}
            </button>
            <button class="secondary-button" type="button" :disabled="!hasDeploymentBridge" @click="refreshDeployPreview">刷新预览</button>
            <button class="secondary-button" type="button" @click="emit('open-logs')">查看日志</button>
          </div>

          <div class="deploy-action-status" :class="{ active: isDeploying, ok: deployResult?.ok, failed: deployResult && !deployResult.ok }">
            <span></span>
            <p class="command-hint">{{ deployHint }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="panel deploy-panel deploy-preview-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Deployment Plan</p>
          <h3>部署预览</h3>
        </div>
        <span class="state-pill">{{ deployPreview?.imageRef || 'Pending' }}</span>
      </div>

      <dl class="package-meta-grid deploy-meta-grid">
        <div>
          <dt>远程包</dt>
          <dd>{{ deployPreview?.remotePackagePath || '-' }}</dd>
        </div>
        <div>
          <dt>发布目录</dt>
          <dd>{{ deployPreview?.remoteReleaseDir || '-' }}</dd>
        </div>
        <div>
          <dt>镜像引用</dt>
          <dd>{{ deployPreview?.imageRef || '-' }}</dd>
        </div>
        <div>
          <dt>容器名</dt>
          <dd>{{ deployPreview?.containerName || '-' }}</dd>
        </div>
        <div class="wide">
          <dt>环境变量</dt>
          <dd class="deploy-inline-list">{{ environmentLines.join(' | ') || '暂无' }}</dd>
        </div>
        <div class="wide">
          <dt>挂载目录</dt>
          <dd class="deploy-inline-list">{{ mountLines.join(' | ') || '暂无' }}</dd>
        </div>
        <div class="wide">
          <dt>创建目录命令</dt>
          <dd class="dockerfile-preview">
            <pre><code>{{ deployPreview?.mkdirCommand || '等待填写部署参数' }}</code></pre>
          </dd>
        </div>
        <div class="wide">
          <dt>Docker Run</dt>
          <dd class="dockerfile-preview deploy-command-preview">
            <pre><code>{{ deployPreview?.runCommand || '等待填写部署参数' }}</code></pre>
          </dd>
        </div>
      </dl>

      <div v-if="deployResult" class="package-result-block">
        <p :class="['result-message', { ok: deployResult.ok }]">{{ deployResult.message }}</p>
        <div class="command-meta">
          <span class="command-stat">耗时: {{ deployResult.durationMs }} ms</span>
          <span class="command-stat">容器: {{ deployResult.containerName || '-' }}</span>
          <span class="command-stat">镜像: {{ deployResult.imageRef || '-' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
