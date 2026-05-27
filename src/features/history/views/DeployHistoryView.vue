<script setup>
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

// 展示已经持久化的镜像打包/部署流水记录。
const { deployments } = useWorkspaceSession()
</script>

<template>
  <section class="panel history-panel">
    <div class="panel-header">
      <div>
        <p class="eyebrow">Local Records</p>
        <h3>部署记录</h3>
      </div>
      <span class="state-pill">{{ deployments.length }} 条</span>
    </div>

    <div v-if="!deployments.length" class="history-empty">
      <strong>暂无记录</strong>
      <span>生成镜像包后，记录会保存到用户目录下的 .cendLink 数据库。</span>
    </div>

    <div v-else class="history-list">
      <article v-for="item in deployments" :key="item.id" class="history-row">
        <div>
          <strong>{{ item.artifactName || item.projectId }}</strong>
          <small>{{ item.deployPath || '本地镜像包' }} · {{ item.createdAt }}</small>
        </div>
        <span
          class="state-pill"
          :class="{
            success: item.status === 'package_success' || item.status === 'success',
            failed: item.status === 'package_failed' || item.status === 'failed',
          }"
        >
          {{ item.status }}
        </span>
      </article>
    </div>
  </section>
</template>
