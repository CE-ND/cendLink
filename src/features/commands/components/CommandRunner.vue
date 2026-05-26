<script setup>
import { computed } from 'vue'

// 命令执行器负责一次性 Linux 命令输入，并展示最近一次执行摘要。
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  busy: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  result: {
    type: Object,
    default: null,
  },
  hint: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'execute', 'clear'])

const executeDisabled = computed(() => {
  return props.busy || props.disabled || !props.modelValue.trim()
})

function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !executeDisabled.value) {
    emit('execute')
  }
}
</script>

<template>
  <section class="panel command-panel">
    <div class="panel-header">
      <div>
        <p class="eyebrow">Command Runner</p>
        <h3>命令执行</h3>
      </div>
      <span class="state-pill" :class="{ success: result?.ok, failed: result && !result.ok }">
        {{ busy ? 'Running' : result?.status || 'Idle' }}
      </span>
    </div>

    <div class="command-body">
      <textarea
        class="command-textarea"
        :value="modelValue"
        :disabled="busy || disabled"
        placeholder="例如：&#10;pwd&#10;ls -la /opt/app&#10;systemctl status my-service"
        @input="emit('update:modelValue', $event.target.value)"
        @keydown="handleKeydown"
      ></textarea>

      <div class="command-actions">
        <button class="primary-button" type="button" :disabled="executeDisabled" @click="emit('execute')">
          {{ busy ? '执行中...' : '执行命令' }}
        </button>
        <button class="secondary-button" type="button" @click="emit('clear')">清空输出</button>
      </div>

      <div class="command-meta">
        <span class="command-stat">Exit code: {{ result?.exitCode ?? '-' }}</span>
        <span class="command-stat">耗时: {{ result?.durationMs ? `${result.durationMs} ms` : '-' }}</span>
      </div>

      <p class="command-hint">{{ hint }}</p>
      <p v-if="result" class="command-message" :class="{ ok: result.ok }">{{ result.message }}</p>
    </div>
  </section>
</template>
