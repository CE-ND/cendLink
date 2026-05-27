<script setup>
import { computed, onMounted } from 'vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

// 本地镜像包生成页，负责展示 Jar -> Docker 镜像压缩包的完整流程。
const {
  packageForm,
  packagePreview,
  packageResult,
  isBuildingPackage,
  canBuildImagePackage,
  packageHint,
  updatePackageForm,
  selectJarFile,
  refreshPackagePreview,
  buildImagePackage,
} = useWorkspaceSession()

const previewLines = computed(() => {
  return packagePreview.value?.dockerfileText?.split('\n') || []
})

const javaVersionOptions = ['17', '21']

function updateJavaVersion(javaVersion) {
  updatePackageForm({
    javaVersion,
    baseImage: `eclipse-temurin:${javaVersion}-jre-alpine`,
  })
}

onMounted(() => {
  refreshPackagePreview()
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

      <div class="package-fields">
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
          <label class="field fill">
            <span>JVM 参数</span>
            <input
              :value="packageForm.javaOpts"
              type="text"
              @input="updatePackageForm({ javaOpts: $event.target.value })"
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

        <section class="advanced-box">
          <div>
            <p class="eyebrow">Advanced</p>
            <h3>运行环境</h3>
          </div>

          <div class="field">
            <span>Java 版本</span>
            <div class="segmented">
              <button
                v-for="version in javaVersionOptions"
                :key="version"
                type="button"
                :class="{ selected: packageForm.javaVersion === version }"
                @click="updateJavaVersion(version)"
              >
                Java {{ version }}
              </button>
            </div>
          </div>

          <label class="checkbox-field">
            <input
              :checked="packageForm.useNonRootUser"
              type="checkbox"
              @change="updatePackageForm({ useNonRootUser: $event.target.checked })"
            />
            <span>创建非 root 用户运行服务</span>
          </label>

          <label v-if="packageForm.useNonRootUser" class="field">
            <span>运行用户</span>
            <input
              :value="packageForm.appUser"
              type="text"
              placeholder="spring"
              @input="updatePackageForm({ appUser: $event.target.value })"
            />
          </label>
        </section>

        <div class="panel-actions">
          <button class="primary-button" type="button" :disabled="!canBuildImagePackage || isBuildingPackage" @click="buildImagePackage">
            {{ isBuildingPackage ? '生成中...' : '生成镜像包' }}
          </button>
          <button class="secondary-button" type="button" @click="refreshPackagePreview">刷新预览</button>
        </div>

        <p class="command-hint">{{ packageHint }}</p>
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

      <div v-if="packageResult" class="package-result-block">
        <p :class="['result-message', { ok: packageResult.ok }]">{{ packageResult.message }}</p>
        <div class="command-meta">
          <span class="command-stat">耗时: {{ packageResult.durationMs }} ms</span>
          <span class="command-stat">包大小: {{ packageResult.packageSizeBytes || 0 }} bytes</span>
          <span class="command-stat">输出: {{ packageResult.packageFileName || '-' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
