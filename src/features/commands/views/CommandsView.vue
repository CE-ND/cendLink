<script setup>
import { ref } from 'vue'
import SshTerminal from '../components/SshTerminal.vue'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'

// 命令页现在是一个真·交互式终端，直接复用工作区当前的 SSH 连接。
const pageRef = ref(null)
usePageEntrance(pageRef)
</script>

<template>
  <div ref="pageRef" class="command-view">
    <SshTerminal />
  </div>
</template>
