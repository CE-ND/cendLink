<script setup>
import CommandRunner from '../components/CommandRunner.vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

// 命令页专注于基于当前 SSH 配置执行一次性远程命令。
const emit = defineEmits(['open-logs'])

const {
  commandText,
  commandResult,
  isExecutingCommand,
  canExecuteCommand,
  commandHint,
  updateCommandText,
  executeCommand,
  clearLogs,
} = useWorkspaceSession()
</script>

<template>
  <div class="command-view">
    <CommandRunner
      :model-value="commandText"
      :busy="isExecutingCommand"
      :disabled="!canExecuteCommand"
      :result="commandResult"
      :hint="commandHint"
      @update:model-value="updateCommandText"
      @execute="executeCommand"
      @clear="clearLogs"
      @open-logs="emit('open-logs')"
    />
  </div>
</template>
