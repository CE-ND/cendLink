<script setup>
import { computed, onMounted } from 'vue'
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
  updateDeployForm,
  selectDeployPackageFile,
  refreshDeployPreview,
  runDeployment,
} = useWorkspaceSession()

const selectedServer = computed(() => {
  return savedServers.value.find((item) => item.id === activeServerId.value) || null
})

const environmentLines = computed(() => {
  return deployPreview.value?.envVars?.map((item) => `${item.key}=${item.value}`) || []
})

const mountLines = computed(() => {
  return deployPreview.value?.mounts?.map((item) => `${item.hostPath} -> ${item.containerPath}`) || []
})

const packageHistory = computed(() => {
  return deployments.value.filter((item) => item.status === 'package_success')
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

onMounted(() => {
  refreshDeployPreview()
})
</script>

<template>
  <div class="deploy-view">
    <section class="panel deploy-panel deploy-form-panel">
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
          <label class="field">
            <span>目标服务器</span>
            <input :value="selectedServer ? `${selectedServer.name} · ${selectedServer.host}:${selectedServer.port}` : '请先在左侧选择服务器'" type="text" readonly />
          </label>

          <div class="field">
            <span>镜像包 tar.gz</span>
            <div class="file-input-row deploy-file-row">
              <input
                :value="deployForm.localPackagePath"
                type="text"
                placeholder="请选择本地镜像包 tar.gz"
                readonly
              />
              <button type="button" class="secondary-button" @click="selectDeployPackageFile">选择包</button>
            </div>
          </div>

          <div v-if="packageHistory.length" class="deploy-history-picks">
            <span class="field-prompt">最近打包记录</span>
            <div class="deploy-history-list">
              <button
                v-for="item in packageHistory.slice(0, 6)"
                :key="item.id"
                type="button"
                class="deploy-history-item"
                :class="{ active: deployForm.localPackagePath === item.deployPath }"
                @click="applyHistoryPackage(item)"
              >
                <strong>{{ item.metadata?.serviceName || item.projectId || item.artifactName }}</strong>
                <small>{{ item.deployPath }}</small>
              </button>
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

        <div class="package-actions deploy-actions">
          <div class="panel-actions">
            <button class="primary-button" type="button" :disabled="!canDeploy || isDeploying" @click="runDeployment">
              {{ isDeploying ? '部署中...' : '开始部署' }}
            </button>
            <button class="secondary-button" type="button" @click="refreshDeployPreview">刷新预览</button>
          </div>

          <p class="command-hint">{{ deployHint }}</p>
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
