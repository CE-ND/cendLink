<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { Copy, Check } from '@lucide/vue'

// 通用复制按钮：拷贝 value 到剪贴板并短暂闪“已复制”。幽灵样式，悬停/聚焦显现。
const props = defineProps({
  value: { type: String, default: '' },
  label: { type: String, default: '复制' },
  size: { type: Number, default: 14 },
})

const copied = ref(false)
let timer = null

async function copy() {
  const text = String(props.value || '')
  if (!text || text === '-') {
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = false
    }, 1400)
  } catch {
    // 剪贴板不可用时静默忽略，复制只是便利功能。
  }
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button
    type="button"
    class="copy-button"
    :class="{ copied }"
    :disabled="!value || value === '-'"
    :title="copied ? '已复制' : label"
    :aria-label="label"
    @click.stop="copy"
  >
    <Check v-if="copied" :size="size" aria-hidden="true" />
    <Copy v-else :size="size" aria-hidden="true" />
  </button>
</template>
