<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 展示当前工作区的共享活动日志，并支持放大查看长日志。
defineProps({
  // 已格式化的日志行，由 useWorkspaceSession 统一维护。
  lines: {
    type: Array,
    default: () => [],
  },
})

// 是否打开日志放大弹窗。
const isExpanded = ref(false)

/**
 * 打开日志放大视图。
 */
function openExpanded() {
  isExpanded.value = true
}

/**
 * 关闭日志放大视图。
 */
function closeExpanded() {
  isExpanded.value = false
}

/**
 * Esc 快捷键关闭弹窗。
 */
function handleWindowKeydown(event) {
  if (event.key === 'Escape' && isExpanded.value) {
    closeExpanded()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <section class="terminal-panel" aria-label="活动日志">
    <header>
      <div class="terminal-header-actions">
        <span>Activity Log</span>
        <small>{{ lines.length }} lines</small>
      </div>
      <button class="terminal-action" type="button" @click="openExpanded">放大查看</button>
    </header>
    <pre class="terminal-scrollable"><code>{{ lines.length ? lines.join('\n') : '暂无输出' }}</code></pre>
  </section>

  <teleport to="body">
    <div
      v-if="isExpanded"
      class="terminal-modal"
      role="dialog"
      aria-modal="true"
      aria-label="活动日志放大查看"
      @click="closeExpanded"
    >
      <section class="terminal-modal-card" @click.stop>
        <header class="terminal-modal-header">
          <div class="terminal-header-actions">
            <strong>Activity Log</strong>
            <small>{{ lines.length }} lines</small>
          </div>
          <button class="terminal-action" type="button" @click="closeExpanded">关闭</button>
        </header>
        <pre class="terminal-modal-body terminal-scrollable"><code>{{ lines.length ? lines.join('\n') : '暂无输出' }}</code></pre>
      </section>
    </div>
  </teleport>
</template>
