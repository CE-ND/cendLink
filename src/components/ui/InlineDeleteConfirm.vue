<script setup>
import { onMounted, ref } from 'vue'
import { CircleAlert, LoaderCircle, Trash2 } from '@lucide/vue'

const props = defineProps({
  title: {
    type: String,
    default: '确认删除',
  },
  message: {
    type: String,
    default: '',
  },
  confirmLabel: {
    type: String,
    default: '确认删除',
  },
  busy: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['confirm', 'cancel'])
const cancelButtonRef = ref(null)
const titleId = `inline-delete-title-${Math.random().toString(36).slice(2, 9)}`
const messageId = `inline-delete-message-${Math.random().toString(36).slice(2, 9)}`

function requestCancel() {
  if (!props.busy) {
    emit('cancel')
  }
}

onMounted(() => {
  requestAnimationFrame(() => cancelButtonRef.value?.focus())
})
</script>

<template>
  <div
    class="inline-delete-confirm"
    role="alert"
    :aria-labelledby="titleId"
    :aria-describedby="message ? messageId : undefined"
    @keydown.esc.stop.prevent="requestCancel"
  >
    <div class="inline-delete-copy">
      <div class="inline-delete-icon" aria-hidden="true">
        <CircleAlert :size="16" />
      </div>
      <div class="inline-delete-text">
        <strong :id="titleId" :title="title">{{ title }}</strong>
        <p v-if="message" :id="messageId">{{ message }}</p>
      </div>
    </div>

    <div class="inline-delete-actions">
      <button
        ref="cancelButtonRef"
        class="inline-delete-cancel"
        type="button"
        :disabled="busy"
        @click="requestCancel"
      >
        取消
      </button>
      <button
        class="inline-delete-submit"
        type="button"
        :disabled="busy"
        @click="emit('confirm')"
      >
        <LoaderCircle v-if="busy" class="inline-delete-spinner" :size="14" aria-hidden="true" />
        <Trash2 v-else :size="14" aria-hidden="true" />
        {{ busy ? '删除中...' : confirmLabel }}
      </button>
    </div>
  </div>
</template>
