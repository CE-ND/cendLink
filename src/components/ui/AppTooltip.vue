<script setup>
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  placement: {
    type: String,
    default: 'top',
    validator: (value) => ['top', 'bottom'].includes(value),
  },
})

const triggerRef = ref(null)
const layerRef = ref(null)
const isOpen = ref(false)
const isPositioned = ref(false)
const resolvedPlacement = ref(props.placement)
const layerStyle = ref({ left: '0px', top: '0px' })
const tooltipId = `app-tooltip-${useId()}`

let isHovered = false
let isFocused = false

watch(isOpen, (open) => {
  if (!open) {
    removePositionListeners()
    return
  }

  addPositionListeners()
  void nextTick(updatePosition)
})

onBeforeUnmount(removePositionListeners)

function openTooltip() {
  if (!props.content) {
    return
  }

  if (!isOpen.value) {
    isPositioned.value = false
  }
  isOpen.value = true
}

function syncOpenState() {
  if (isHovered || isFocused) {
    openTooltip()
    return
  }

  isOpen.value = false
}

function handleMouseEnter() {
  isHovered = true
  openTooltip()
}

function handleMouseLeave() {
  isHovered = false
  syncOpenState()
}

function handleFocus() {
  isFocused = true
  openTooltip()
}

function handleBlur() {
  isFocused = false
  syncOpenState()
}

function closeFromKeyboard() {
  isHovered = false
  isFocused = false
  isOpen.value = false
}

function handleAfterLeave() {
  if (!isOpen.value) {
    isPositioned.value = false
  }
}

function addPositionListeners() {
  window.addEventListener('resize', updatePosition)
  document.addEventListener('scroll', updatePosition, true)
}

function removePositionListeners() {
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('scroll', updatePosition, true)
}

function updatePosition() {
  if (!isOpen.value || !triggerRef.value || !layerRef.value) {
    return
  }

  const triggerRect = triggerRef.value.getBoundingClientRect()
  const layerRect = layerRef.value.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const edge = 8
  const gap = 9

  const triggerIsVisible =
    triggerRect.bottom > 0 &&
    triggerRect.top < viewportHeight &&
    triggerRect.right > 0 &&
    triggerRect.left < viewportWidth

  if (!triggerIsVisible) {
    isPositioned.value = false
    return
  }

  const fitsTop = triggerRect.top >= layerRect.height + gap + edge
  const fitsBottom = viewportHeight - triggerRect.bottom >= layerRect.height + gap + edge
  let nextPlacement = props.placement

  if (props.placement === 'top' && !fitsTop && fitsBottom) {
    nextPlacement = 'bottom'
  } else if (props.placement === 'bottom' && !fitsBottom && fitsTop) {
    nextPlacement = 'top'
  }

  const idealLeft = triggerRect.left + triggerRect.width / 2 - layerRect.width / 2
  const maxLeft = Math.max(edge, viewportWidth - layerRect.width - edge)
  const left = Math.min(Math.max(edge, idealLeft), maxLeft)
  const triggerCenter = triggerRect.left + triggerRect.width / 2
  const arrowLeft = Math.min(Math.max(12, triggerCenter - left), layerRect.width - 12)
  const idealTop =
    nextPlacement === 'top'
      ? triggerRect.top - layerRect.height - gap
      : triggerRect.bottom + gap
  const maxTop = Math.max(edge, viewportHeight - layerRect.height - edge)
  const top = Math.min(Math.max(edge, idealTop), maxTop)

  resolvedPlacement.value = nextPlacement
  layerStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    '--app-tooltip-arrow-left': `${Math.round(arrowLeft)}px`,
  }
  isPositioned.value = true
}
</script>

<template>
  <span
    ref="triggerRef"
    class="app-tooltip-trigger"
    v-bind="$attrs"
    tabindex="0"
    :aria-describedby="tooltipId"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @focus="handleFocus"
    @blur="handleBlur"
    @keydown.esc.stop="closeFromKeyboard"
  >
    <slot />
  </span>

  <Teleport to="body">
    <Transition name="app-tooltip" @after-leave="handleAfterLeave">
      <span
        v-show="isOpen"
        :id="tooltipId"
        ref="layerRef"
        class="app-tooltip-layer"
        :class="[`is-${resolvedPlacement}`, { 'is-positioned': isPositioned }]"
        :style="layerStyle"
        role="tooltip"
      >
        <span class="app-tooltip-bubble">{{ content }}</span>
      </span>
    </Transition>
  </Teleport>
</template>
