import { onBeforeUnmount, watch } from 'vue'

// 弹层焦点管理：打开时把焦点移入面板（可指定初始控件）并记住来源，Tab 在面板内循环，
// 关闭时把焦点归还给触发元素。配合各弹层已有的 Escape/scrim 关闭，补齐键盘可达性。
//
// activeRef:  boolean 的 ref / computed / getter 函数（弹层是否打开）。
// getContainer: () => 面板根 DOM 元素。
// options.initialFocus: () => 打开时优先聚焦的元素（默认取面板内首个可聚焦项）。

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(activeRef, getContainer, options = {}) {
  let previouslyFocused = null

  function focusableItems() {
    const root = getContainer?.()
    if (!root) {
      return []
    }
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => el.getClientRects().length > 0,
    )
  }

  function handleKeydown(event) {
    if (event.key !== 'Tab') {
      return
    }

    const root = getContainer?.()
    const items = focusableItems()

    if (!root || !items.length) {
      event.preventDefault()
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !root.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  function activate() {
    previouslyFocused = document.activeElement
    document.addEventListener('keydown', handleKeydown, true)

    // 下一帧面板已渲染，移焦到指定初始控件或首个可聚焦项。
    requestAnimationFrame(() => {
      const target = options.initialFocus?.() || focusableItems()[0] || getContainer?.()
      target?.focus?.()
    })
  }

  function deactivate() {
    document.removeEventListener('keydown', handleKeydown, true)
    const toRestore = previouslyFocused
    previouslyFocused = null

    if (toRestore && typeof toRestore.focus === 'function') {
      requestAnimationFrame(() => toRestore.focus())
    }
  }

  watch(activeRef, (isActive) => {
    if (isActive) {
      activate()
    } else {
      deactivate()
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown, true)
  })
}
