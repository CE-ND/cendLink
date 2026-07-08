import { onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'

// 统一的页面入场过渡：进入路由时，页面顶层面板/区块淡入上浮、轻微错峰，
// 与远程部署页的入场风格保持一致，让各页面切换体验统一。
//
// 用法：在视图 setup 里 const pageRef = ref(null)，根元素绑定 ref="pageRef"，
// 再调用 usePageEntrance(pageRef)。默认对根元素的直接子元素做错峰；
// 也可传 { targets: '.selector' } 指定更细的目标。
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

    // gsap.matchMedia 在偏好减弱动效时不执行入场，内容按默认静态呈现。
    mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(targets, {
        autoAlpha: 0,
        y: 8,
        duration: 0.26,
        ease: 'power3.out',
        stagger: 0.05,
        clearProps: 'opacity,visibility,transform',
      })
    })
  })

  onBeforeUnmount(() => {
    mm?.revert()
    mm = null
  })
}
