<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 展示当前工作区的共享活动日志，并支持放大查看长日志。
defineProps({
  lines: {
    type: Array,
    default: () => [],
  },
})

const isExpanded = ref(false)

function openExpanded() {
  isExpanded.value = true
}

function closeExpanded() {
  isExpanded.value = false
}

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
