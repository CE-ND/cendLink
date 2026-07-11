import { onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'

// 统一的页面入场过渡。
//
// 首次进入应用时保留一次完整的到场感（轻微上浮 + 错峰）；此后每次切页只做近即时的
// 纯淡入（~140ms、无位移无错峰），避免把编排式入场当成日常导航反复重放——产品类
// 工具更需要像 Linear/Raycast 那样利落的切换，而非每次都“重新加载”一遍。
//
// 用法：在视图 setup 里 const pageRef = ref(null)，根元素绑定 ref="pageRef"，
// 再调用 usePageEntrance(pageRef)。默认对根元素的直接子元素做处理；
// 也可传 { targets: '.selector' } 指定更细的目标。

// 模块级标记：首次挂载的视图即“首次进入应用”，其后皆为应用内导航。
let hasEnteredApp = false

export function usePageEntrance(rootRef, options = {}) {
  let mm = null

  onMounted(() => {
    const root = rootRef.value

    if (!root) {
      return
    }

    const targets = options.targets ? root.querySelectorAll(options.targets) : root.children

    if (!targets || !targets.length) {
      return
    }

    const firstEntrance = !hasEnteredApp
    hasEnteredApp = true

    // gsap.matchMedia 在偏好减弱动效时不执行入场，内容按默认静态呈现。
    mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      if (firstEntrance) {
        // 首次进入：一次性的上浮 + 错峰入场。
        gsap.from(targets, {
          autoAlpha: 0,
          y: 8,
          duration: 0.26,
          ease: 'power3.out',
          stagger: 0.05,
          clearProps: 'opacity,visibility,transform',
        })
      } else {
        // 应用内切页：仅淡入，无位移、无错峰，近即时。
        gsap.from(targets, {
          autoAlpha: 0,
          duration: 0.14,
          ease: 'power2.out',
          clearProps: 'opacity,visibility',
        })
      }
    })
  })

  onBeforeUnmount(() => {
    mm?.revert()
    mm = null
  })
}
