<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// 「发起即等待」管线的诚实活性反馈：
//  · 运行中：脉冲点 + 实时 mm:ss 计时 + 单条不确定 shimmer + 锚定步骤（pending，虚线）。
//  · 结束后：以真实 steps[] 逐条标记 success/failed，错峰入场；耗时以结果的 durationMs 为准。
// 刻意不伪造百分比进度——只如实呈现“在动 / 已完成第几步 / 用时多久”。
const props = defineProps({
  active: { type: Boolean, default: false },
  result: { type: Object, default: null },
  // 锚定步骤（运行中先按 pending 展示）：[{ key, label }]
  stages: { type: Array, default: () => [] },
  runningText: { type: String, default: '执行中…' },
})

const elapsedMs = ref(0)
let startedAt = 0
let timer = null

function stopTimer() {
  if (timer) {
    window.clearInterval(timer)
    timer = null
  }
}

watch(
  () => props.active,
  (isActive) => {
    stopTimer()
    if (isActive) {
      startedAt = Date.now()
      elapsedMs.value = 0
      timer = window.setInterval(() => {
        elapsedMs.value = Date.now() - startedAt
      }, 1000)
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopTimer)

// 运行中显示实时计时；结束后以结果里的权威耗时冻结。
const displayMs = computed(() => (props.active ? elapsedMs.value : Number(props.result?.durationMs || 0)))

const elapsedLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.floor(displayMs.value / 1000))
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
})

const resultOk = computed(() => props.result?.ok === true)
const resultFailed = computed(() => Boolean(props.result) && props.result.ok !== true)

const headState = computed(() => {
  if (props.active) return 'running'
  if (resultOk.value) return 'ok'
  if (resultFailed.value) return 'failed'
  return 'idle'
})

const headText = computed(() => {
  if (props.active) return props.runningText
  return props.result?.message || ''
})

const resultSteps = computed(() => (Array.isArray(props.result?.steps) ? props.result.steps : []))
const showResultSteps = computed(() => !props.active && resultSteps.value.length > 0)

function stepStateClass(status) {
  const value = String(status || '').toLowerCase()
  if (['success', 'ok', 'done', 'passed'].includes(value)) return 'done'
  if (['warning', 'warn'].includes(value)) return 'warning'
  if (['failed', 'error'].includes(value)) return 'failed'
  if (value === 'skipped') return 'skipped'
  return 'pending'
}

function formatStepTime(ms) {
  const value = Number(ms || 0)
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}
</script>

<template>
  <div class="run-progress" :class="headState" role="status" aria-live="polite">
    <div class="run-progress-head">
      <span class="run-progress-dot" :class="headState"></span>
      <strong class="run-progress-text">{{ headText }}</strong>
      <span class="run-progress-elapsed">{{ elapsedLabel }}</span>
    </div>

    <div v-if="active" class="run-progress-bar" aria-hidden="true"><span></span></div>

    <ul v-if="active && stages.length" class="run-progress-steps pending">
      <li v-for="stage in stages" :key="stage.key" class="run-progress-step pending">
        <span class="run-progress-mark"></span>
        <span class="run-progress-label">{{ stage.label }}</span>
      </li>
    </ul>

    <ul v-else-if="showResultSteps" class="run-progress-steps">
      <li
        v-for="(step, index) in resultSteps"
        :key="step.name || index"
        class="run-progress-step"
        :class="stepStateClass(step.status)"
        :style="{ '--i': index }"
      >
        <span class="run-progress-mark"></span>
        <span class="run-progress-label">{{ step.name }}</span>
        <span v-if="step.durationMs" class="run-progress-step-time">{{ formatStepTime(step.durationMs) }}</span>
      </li>
    </ul>
  </div>
</template>
