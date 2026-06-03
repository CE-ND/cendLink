<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number, Boolean],
    default: '',
  },
  options: {
    type: Array,
    default: () => [],
  },
  placeholder: {
    type: String,
    default: '请选择',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'change'])

const rootRef = ref(null)
const triggerRef = ref(null)
const menuRef = ref(null)
const isOpen = ref(false)
const highlightedIndex = ref(-1)
const menuStyle = ref({})

const menuId = `app-select-${Math.random().toString(36).slice(2, 10)}`

const normalizedItems = computed(() => {
  return props.options.flatMap((item) => {
    if (Array.isArray(item?.options)) {
      return [
        {
          type: 'group',
          label: String(item.label || ''),
          key: `group-${String(item.label || '')}`,
        },
        ...item.options.map((option) => normalizeOption(option)),
      ]
    }

    return [normalizeOption(item)]
  })
})

const selectableOptions = computed(() => normalizedItems.value.filter((item) => item.type === 'option' && !item.disabled))

const selectedOption = computed(() => {
  return selectableOptions.value.find((item) => isSameValue(item.value, props.modelValue)) || null
})

const selectedLabel = computed(() => {
  return selectedOption.value?.label || props.placeholder
})

watch(isOpen, (open) => {
  if (open) {
    addGlobalListeners()
    void nextTick(() => {
      syncMenuPosition()
      highlightSelected()
    })
    return
  }

  removeGlobalListeners()
})

onBeforeUnmount(() => {
  removeGlobalListeners()
})

function normalizeOption(option) {
  if (option && typeof option === 'object') {
    return {
      type: 'option',
      value: option.value,
      label: String(option.label ?? option.value ?? ''),
      disabled: Boolean(option.disabled),
      key: `option-${String(option.value)}`,
    }
  }

  return {
    type: 'option',
    value: option,
    label: String(option ?? ''),
    disabled: false,
    key: `option-${String(option)}`,
  }
}

function isSameValue(left, right) {
  return String(left) === String(right)
}

function toggleMenu() {
  if (props.disabled) {
    return
  }

  isOpen.value ? closeMenu() : openMenu()
}

function openMenu() {
  if (props.disabled || isOpen.value) {
    return
  }

  isOpen.value = true
}

function closeMenu() {
  isOpen.value = false
}

function selectOption(option) {
  if (!option || option.disabled) {
    return
  }

  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeMenu()
  void nextTick(() => triggerRef.value?.focus())
}

function highlightSelected() {
  const selectedIndex = selectableOptions.value.findIndex((item) => isSameValue(item.value, props.modelValue))
  highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : 0
}

function moveHighlight(step) {
  const options = selectableOptions.value

  if (!options.length) {
    highlightedIndex.value = -1
    return
  }

  const current = highlightedIndex.value < 0 ? 0 : highlightedIndex.value
  highlightedIndex.value = (current + step + options.length) % options.length
}

function handleKeydown(event) {
  if (props.disabled) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()

    if (!isOpen.value) {
      openMenu()
      return
    }

    moveHighlight(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()

    if (!isOpen.value) {
      openMenu()
      return
    }

    moveHighlight(-1)
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()

    if (!isOpen.value) {
      openMenu()
      return
    }

    selectOption(selectableOptions.value[highlightedIndex.value])
    return
  }

  if (event.key === 'Escape') {
    closeMenu()
    return
  }

  if (event.key === 'Tab') {
    closeMenu()
  }
}

function syncMenuPosition() {
  const trigger = triggerRef.value

  if (!trigger) {
    return
  }

  const rect = trigger.getBoundingClientRect()
  const availableBelow = window.innerHeight - rect.bottom - 8
  const availableAbove = rect.top - 8
  const opensAbove = availableBelow < 180 && availableAbove > availableBelow
  const maxHeight = Math.max(120, Math.min(260, opensAbove ? availableAbove : availableBelow))

  menuStyle.value = {
    left: `${rect.left}px`,
    top: opensAbove ? 'auto' : `${rect.bottom + 4}px`,
    bottom: opensAbove ? `${window.innerHeight - rect.top + 4}px` : 'auto',
    width: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
  }
}

function handleDocumentPointerDown(event) {
  const target = event.target

  if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) {
    return
  }

  closeMenu()
}

function addGlobalListeners() {
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  window.addEventListener('resize', syncMenuPosition)
  window.addEventListener('scroll', syncMenuPosition, true)
}

function removeGlobalListeners() {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  window.removeEventListener('resize', syncMenuPosition)
  window.removeEventListener('scroll', syncMenuPosition, true)
}
</script>

<template>
  <div ref="rootRef" class="app-select" :class="{ open: isOpen, disabled }">
    <button
      ref="triggerRef"
      type="button"
      class="select-input app-select-trigger"
      :class="{ placeholder: !selectedOption }"
      :disabled="disabled"
      :aria-expanded="isOpen"
      :aria-controls="menuId"
      aria-haspopup="listbox"
      @click="toggleMenu"
      @keydown="handleKeydown"
    >
      <span class="app-select-value">{{ selectedLabel }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        :id="menuId"
        ref="menuRef"
        class="app-select-menu"
        :style="menuStyle"
        role="listbox"
      >
        <template v-for="item in normalizedItems" :key="item.key">
          <div v-if="item.type === 'group'" class="app-select-group">
            {{ item.label }}
          </div>
          <button
            v-else
            type="button"
            class="app-select-option"
            :class="{
              selected: selectedOption && isSameValue(item.value, selectedOption.value),
              active: selectableOptions[highlightedIndex] && isSameValue(item.value, selectableOptions[highlightedIndex].value),
              disabled: item.disabled,
            }"
            :disabled="item.disabled"
            role="option"
            :aria-selected="selectedOption && isSameValue(item.value, selectedOption.value)"
            @mouseenter="highlightedIndex = selectableOptions.findIndex((option) => isSameValue(option.value, item.value))"
            @click="selectOption(item)"
          >
            <span>{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
