<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@lucide/vue'

// 展示当前工作区的共享活动日志，并支持放大查看长日志。
const props = defineProps({
  // 已格式化的日志行，由 useWorkspaceSession 统一维护。
  lines: {
    type: Array,
    default: () => [],
  },
  // 是否渲染底部常驻日志面板；部分页面只通过外部按钮打开弹窗。
  inline: {
    type: Boolean,
    default: true,
  },
})

// 是否打开日志放大弹窗。
const isExpanded = ref(false)
// 常规日志面板滚动容器。
const inlineLogRef = ref(null)
// 放大弹窗日志滚动容器。
const modalLogRef = ref(null)

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

defineExpose({
  openExpanded,
  closeExpanded,
})

// 复制当前活动日志到剪贴板，短暂闪“已复制”。
const copiedLog = ref(false)
let copiedLogTimer = null

async function copyLog() {
  if (!props.lines.length) {
    return
  }

  try {
    await navigator.clipboard.writeText(props.lines.join('\n'))
    copiedLog.value = true
    clearTimeout(copiedLogTimer)
    copiedLogTimer = setTimeout(() => {
      copiedLog.value = false
    }, 1400)
  } catch {
    // 剪贴板不可用时静默忽略。
  }
}

/**
 * 将日志滚动到最新一行。
 */
function scrollToBottom(target) {
  if (!target) {
    return
  }

  target.scrollTop = target.scrollHeight
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
  clearTimeout(copiedLogTimer)
})

watch(
  () => props.lines.length,
  async () => {
    await nextTick()
    scrollToBottom(inlineLogRef.value)

    if (isExpanded.value) {
      scrollToBottom(modalLogRef.value)
    }
  },
)

watch(isExpanded, async (expanded) => {
  if (!expanded) {
    return
  }

  await nextTick()
  scrollToBottom(modalLogRef.value)
})
</script>

<template>
  <section v-if="props.inline" class="terminal-panel" aria-label="活动日志">
    <header>
      <div class="terminal-header-actions">
        <span>Activity Log</span>
        <small>{{ lines.length }} lines</small>
      </div>
      <div class="terminal-header-actions">
        <button
          class="terminal-action"
          type="button"
          :disabled="!lines.length"
          @click="copyLog"
        >
          {{ copiedLog ? '已复制' : '复制' }}
        </button>
        <button class="terminal-action" type="button" @click="openExpanded">放大查看</button>
      </div>
    </header>
    <pre v-if="lines.length" ref="inlineLogRef" class="terminal-scrollable"><code>{{ lines.join('\n') }}</code></pre>
    <div v-else class="terminal-log-empty">
      <Terminal :size="30" :stroke-width="1.5" aria-hidden="true" />
      <p>暂无输出</p>
    </div>
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
          <div class="terminal-header-actions">
            <button
              class="terminal-action"
              type="button"
              :disabled="!lines.length"
              @click="copyLog"
            >
              {{ copiedLog ? '已复制' : '复制' }}
            </button>
            <button class="terminal-action" type="button" @click="closeExpanded">关闭</button>
          </div>
        </header>
        <pre v-if="lines.length" ref="modalLogRef" class="terminal-modal-body terminal-scrollable"><code>{{ lines.join('\n') }}</code></pre>
        <div v-else class="terminal-modal-body terminal-log-empty">
          <Terminal :size="34" :stroke-width="1.5" aria-hidden="true" />
          <p>暂无输出</p>
        </div>
      </section>
    </div>
  </teleport>
</template>
