<script setup>
import { computed, nextTick } from 'vue'

// 命令执行器负责一次性 Linux 命令输入，并展示最近一次执行摘要。
const props = defineProps({
  // 命令输入框文本。
  modelValue: {
    type: String,
    default: '',
  },
  // 远程命令执行中状态。
  busy: {
    type: Boolean,
    default: false,
  },
  // 父组件根据连接状态决定是否允许执行命令。
  disabled: {
    type: Boolean,
    default: false,
  },
  // 最近一次命令执行结果。
  result: {
    type: Object,
    default: null,
  },
  // 当前不可执行或可执行状态的说明文案。
  hint: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'execute', 'clear', 'open-logs'])

const dockerQuickCommands = [
  { label: '运行容器', command: 'docker ps' },
  { label: '全部容器', command: 'docker ps -a' },
  { label: '镜像列表', command: 'docker images' },
  { label: '资源快照', command: 'docker stats --no-stream' },
  { label: '磁盘占用', command: 'docker system df' },
  { label: '数据卷', command: 'docker volume ls' },
  { label: '网络', command: 'docker network ls' },
  { label: '环境信息', command: 'docker info' },
]

// 按钮禁用规则：执行中、连接状态不允许执行、或命令为空。
const executeDisabled = computed(() => {
  return props.busy || props.disabled || !props.modelValue.trim()
})

const quickCommandDisabled = computed(() => {
  return props.busy || props.disabled
})

function handleKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
    return
  }

  event.preventDefault()

  executeWithLogs()
}

function executeWithLogs() {
  if (executeDisabled.value) {
    return
  }

  emit('open-logs')
  emit('execute')
}

async function runQuickCommand(command) {
  if (quickCommandDisabled.value) {
    return
  }

  emit('update:modelValue', command)
  await nextTick()
  emit('open-logs')
  emit('execute')
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
      <div class="command-quickbar" aria-label="Docker 常用查询">
        <span class="command-quickbar-title">Docker 查询</span>
        <div class="command-quickbar-actions">
          <button
            v-for="item in dockerQuickCommands"
            :key="item.command"
            class="quick-command-button"
            type="button"
            :title="item.command"
            :disabled="quickCommandDisabled"
            @click="runQuickCommand(item.command)"
          >
            <span>{{ item.label }}</span>
            <code>{{ item.command }}</code>
          </button>
        </div>
      </div>

      <textarea
        class="command-textarea"
        :value="modelValue"
        :disabled="busy || disabled"
        placeholder="例如：&#10;pwd&#10;ls -la /opt/app&#10;systemctl status my-service"
        @input="emit('update:modelValue', $event.target.value)"
        @keydown="handleKeydown"
      ></textarea>

      <div class="command-actions">
        <button class="primary-button" type="button" :disabled="executeDisabled" @click="executeWithLogs">
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
