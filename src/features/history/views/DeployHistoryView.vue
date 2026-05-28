<script setup>
import { computed, ref } from 'vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

// 展示已经持久化的镜像打包/部署流水记录。
const { deployments, deletingDeploymentIds, deleteDeploymentRecord } = useWorkspaceSession()

const activeRecordType = ref('deploy')

const packageRecords = computed(() => {
  return deployments.value.filter(isPackageRecord)
})

const deployRecords = computed(() => {
  return deployments.value.filter(isDeployRecord)
})

const visibleRecords = computed(() => {
  return activeRecordType.value === 'package' ? packageRecords.value : deployRecords.value
})

const activeTitle = computed(() => {
  return activeRecordType.value === 'package' ? '打包记录' : '部署记录'
})

const activeEmptyText = computed(() => {
  return activeRecordType.value === 'package'
    ? '生成镜像包后，会在这里看到本地 tar.gz 打包记录。'
    : '执行远程部署后，会在这里看到服务器部署记录。'
})

function isPackageRecord(item) {
  return item?.metadata?.recordType === 'image-package' || String(item?.status || '').startsWith('package_')
}

function isDeployRecord(item) {
  return item?.metadata?.recordType === 'remote-deployment' || String(item?.status || '').startsWith('deploy_')
}

function getRecordTitle(item) {
  if (isPackageRecord(item)) {
    return item.metadata?.serviceName || item.projectId || item.artifactName || '镜像打包记录'
  }

  return item.metadata?.containerName || item.artifactName || item.projectId || '远程部署记录'
}

function getRecordSummary(item) {
  if (isPackageRecord(item)) {
    const imageRef = item.metadata?.imageRef || item.projectId || '-'
    const version = item.metadata?.serviceVersion || '-'
    return `${imageRef} · 版本 ${version}`
  }

  const imageRef = item.metadata?.imageRef || item.projectId || '-'
  const remoteReleaseDir = item.metadata?.remoteReleaseDir || item.deployPath || '-'
  return `${imageRef} · ${remoteReleaseDir}`
}

function getDetailItems(item) {
  if (isPackageRecord(item)) {
    return [
      { label: '本地包', value: item.deployPath || '-', wide: true },
      { label: '镜像', value: item.metadata?.imageRef || item.projectId || '-' },
      { label: '模板', value: item.metadata?.dockerfileTemplateName || '-' },
      { label: 'Java', value: item.metadata?.javaVersion || '-' },
      { label: '基础镜像', value: item.metadata?.baseImage || '-', wide: true },
    ]
  }

  return [
    { label: '远程包', value: item.remotePackagePath || item.metadata?.remotePackagePath || '-' },
    { label: '发布目录', value: item.deployPath || item.metadata?.remoteReleaseDir || '-' },
    { label: 'Run 命令', value: item.runCommand || item.metadata?.runCommand || '-', wide: true, command: true },
  ]
}

function getStatusClass(status) {
  return {
    success: ['package_success', 'success', 'deploy_success'].includes(status),
    failed: ['package_failed', 'failed', 'deploy_failed'].includes(status),
  }
}
</script>

<template>
  <section class="panel history-panel">
    <div class="panel-header">
      <div>
        <p class="eyebrow">Local Records</p>
        <h3>{{ activeTitle }}</h3>
      </div>
      <span class="state-pill">{{ visibleRecords.length }} 条</span>
    </div>

    <div class="history-toolbar">
      <div class="history-switch">
        <button
          type="button"
          class="history-switch-button"
          :class="{ active: activeRecordType === 'deploy' }"
          @click="activeRecordType = 'deploy'"
        >
          部署记录
          <span class="history-switch-count">{{ deployRecords.length }}</span>
        </button>
        <button
          type="button"
          class="history-switch-button"
          :class="{ active: activeRecordType === 'package' }"
          @click="activeRecordType = 'package'"
        >
          打包记录
          <span class="history-switch-count">{{ packageRecords.length }}</span>
        </button>
      </div>
    </div>

    <div v-if="!visibleRecords.length" class="history-empty">
      <strong>暂无记录</strong>
      <span>{{ activeEmptyText }}</span>
    </div>

    <div v-else class="history-list">
      <article v-for="item in visibleRecords" :key="item.id" class="history-row">
        <div class="history-row-main">
          <div class="history-row-copy">
            <strong>{{ getRecordTitle(item) }}</strong>
            <small>
              {{ getRecordSummary(item) }} · {{ item.createdAt }}
              <template v-if="item.errorSummary"> · {{ item.errorSummary }}</template>
            </small>
            <div class="history-detail-list">
              <span
                v-for="detail in getDetailItems(item)"
                :key="`${item.id}-${detail.label}`"
                class="history-detail-chip"
                :class="{ wide: detail.wide, command: detail.command }"
                :title="detail.value"
              >
                <span class="history-detail-label">{{ detail.label }}</span>
                <span class="history-detail-value">{{ detail.value }}</span>
              </span>
            </div>
          </div>
          <div class="history-row-actions">
            <span class="state-pill" :class="getStatusClass(item.status)">
              {{ item.status }}
            </span>
            <button
              type="button"
              class="history-delete-button"
              :disabled="deletingDeploymentIds.includes(item.id)"
              @click="deleteDeploymentRecord(item.id)"
            >
              {{ deletingDeploymentIds.includes(item.id) ? '删除中...' : '删除' }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
