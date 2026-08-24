<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { Copy, Check, Trash2 } from '@lucide/vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'

gsap.registerPlugin(Flip)

// 展示已经持久化的镜像打包/部署/前端上传流水记录。
const { deployments, deletingDeploymentIds, deleteDeploymentRecord } = useWorkspaceSession()

const pageRef = ref(null)
const scrollRef = ref(null)
const gridRef = ref(null)
usePageEntrance(pageRef)

// 当前展开/收起的 Flip 补间，切换或卸载时打断，避免叠加。
let flipTween = null
// 把展开卡滚进视野的补间，同样需要可打断。
let scrollTween = null

const activeRecordType = ref('deploy')
// 当前展开详情的记录 id；同一时刻只展开一条，保持列表密度。
const expandedId = ref(null)
// 刚复制成功的字段 key，用于短暂反馈“已复制”。
const copiedKey = ref('')
let copiedTimer = null

// 删除二次确认：首次点击进入“确认”态，~3.5s 内再次点击才真正删除，否则自动还原。
const confirmingDeleteId = ref('')
let confirmDeleteTimer = null

const packageRecords = computed(() => deployments.value.filter(isPackageRecord))
const deployRecords = computed(() => deployments.value.filter(isDeployRecord))
const frontendRecords = computed(() => deployments.value.filter(isFrontendRecord))

const visibleRecords = computed(() => {
  if (activeRecordType.value === 'package') {
    return packageRecords.value
  }

  if (activeRecordType.value === 'frontend') {
    return frontendRecords.value
  }

  return deployRecords.value
})

// 分段控件滑块位置：与模板中 部署/前端/打包 的顺序一致。
const switchIndex = computed(() =>
  Math.max(0, ['deploy', 'frontend', 'package'].indexOf(activeRecordType.value)),
)

const activeTitle = computed(() => {
  if (activeRecordType.value === 'package') {
    return '打包记录'
  }

  if (activeRecordType.value === 'frontend') {
    return '前端上传记录'
  }

  return '部署记录'
})

const activeEmptyText = computed(() => {
  if (activeRecordType.value === 'package') {
    return '生成镜像包后，会在这里看到本地 tar.gz 打包记录。'
  }

  if (activeRecordType.value === 'frontend') {
    return '上传前端压缩包后，会在这里看到静态资源发布记录。'
  }

  return '执行远程部署后，会在这里看到服务器部署记录。'
})

// 底部 meta 条：给高瘦面板一个收口，稀疏时也不显得被截断。
const latestRecordTime = computed(() => {
  const first = visibleRecords.value[0]
  return first ? formatTime(first.createdAt) : '—'
})

// 仅一条记录时默认展开，让详情填满高瘦区域而不是孤零零一行。
watch(
  visibleRecords,
  (records) => {
    if (records.length === 1) {
      expandedId.value = records[0].id
      return
    }

    if (!records.some((item) => item.id === expandedId.value)) {
      expandedId.value = null
    }
  },
  { immediate: true },
)

// 切换记录类型时收起已展开项，避免跨类型残留。
watch(activeRecordType, () => {
  expandedId.value = null
  clearDeleteConfirm()
})

// 清掉补间期间钉在卡片上的内联尺寸变量。补间被打断时 onComplete 不会执行，
// 所以每次开始前也清一遍，否则上一轮的终点尺寸会套到这一轮身上。
function clearFlipPins(grid) {
  grid.querySelectorAll('.history-card').forEach((card) => {
    card.style.removeProperty('--flip-drawer-w')
    card.style.removeProperty('--flip-drawer-h')
    card.classList.remove('is-collapsing')
  })
}

// 卡片放大/缩小用 GSAP Flip 做布局补间：grid 的 span 尺寸切换在 CSS 里不可过渡，
// 这里捕获旧布局 → 切换展开态 → 从旧布局补间到新布局，邻卡顺势让位、抽屉淡入。
// nextId 传 null 表示全部收起。
async function setExpanded(nextId) {
  if (nextId === expandedId.value) {
    return
  }

  const grid = gridRef.value

  if (!grid || prefersReducedMotion()) {
    expandedId.value = nextId
    return
  }

  clearFlipPins(grid)

  // 让位的波从「被操作的那张卡」向两侧扩散，所以先记下它在列表里的位置。
  const originId = nextId || expandedId.value
  const originIndex = Math.max(
    0,
    visibleRecords.value.findIndex((item) => item.id === originId),
  )

  // 先停掉 transform 的 CSS 过渡（改由 GSAP 独占），再捕获旧布局，避免两套动画打架。
  grid.classList.add('is-flipping')
  // 只捕获几何。box-shadow 不交给 GSAP：那是个大半径阴影，跟着卡片一起放大时每帧都要
  // 重绘一大片；交回 CSS 的过渡自己收尾更便宜，也不会和几何抢帧。
  const state = Flip.getState(grid.querySelectorAll('.history-card'))
  // 正在收起的那张卡：补间途中它还是放大尺寸，会溢出自己那一格 —— 不抬层的话会被
  // 右侧和下方的邻卡盖住一角。这里先标记下来（此刻它还带着 .open）。
  const collapsingCard = grid.querySelector('.history-card.open')

  expandedId.value = nextId
  await nextTick()

  // 读：此刻 DOM 与网格都已落在终点状态，量到的就是抽屉的终点几何。
  const openCard = grid.querySelector('.history-card.open')
  const drawer = openCard?.querySelector('.history-drawer') || null
  const drawerWidth = drawer?.offsetWidth || 0
  const drawerHeight = drawer?.offsetHeight || 0
  const openTop = openCard?.offsetTop || 0
  const openHeight = openCard?.offsetHeight || 0

  // 写：把抽屉钉在终点尺寸上，补间途中它一次都不重排（配合 .is-flipping 下的规则）。
  if (drawer) {
    openCard.style.setProperty('--flip-drawer-w', `${drawerWidth}px`)
    openCard.style.setProperty('--flip-drawer-h', `${drawerHeight}px`)
  }

  if (collapsingCard && collapsingCard !== openCard) {
    collapsingCard.classList.add('is-collapsing')
  }

  flipTween?.kill()
  flipTween = Flip.from(state, {
    duration: 0.42,
    ease: 'power2.inOut',
    // absolute 关掉。列宽与行高都是定值（232px），所以改展开卡的 width/height 根本
    // 挪不动任何其它网格项——它只是在自己那块 2×2 区域里从左上角长大。此前开着
    // absolute，15 张卡全被抽出常规流，才被迫去钉网格高度，也才连带出滚动范围塌陷、
    // 一帧滚动条那些问题。关掉之后网格从第一帧起就是终点高度，邻卡只走纯 transform。
    absolute: false,
    scale: false,
    // 没有旋转/斜切，走简化路径，省掉每帧的矩阵解析。
    simple: true,
    // 邻卡整片让位时按距离微错开，读起来是一道从被点卡片扩散出去的波，
    // 而不是十几张卡同时齐刷刷平移。
    stagger: { each: 0.012, from: originIndex },
    onComplete: () => {
      clearFlipPins(grid)
      grid.classList.remove('is-flipping')
    },
    // 补间被打断时 onComplete 不会执行。不清的话 .is-flipping 会一直挂着，
    // 它下面那几条只在补间期间成立的规则就成了常驻状态。
    onInterrupt: () => {
      clearFlipPins(grid)
      grid.classList.remove('is-flipping')
    },
  })

  if (openCard) {
    scrollOpenCardIntoView(openTop, openHeight)
  }
}

// 末行的卡片放大后长出视野时，把它带回来；已经完整可见就不动滚动位置。
function scrollOpenCardIntoView(top, height) {
  const scroll = scrollRef.value

  if (!scroll || !height) {
    return
  }

  const bottom = top + height
  const viewBottom = scroll.scrollTop + scroll.clientHeight

  if (top >= scroll.scrollTop && bottom <= viewBottom) {
    return
  }

  scrollTween?.kill()
  scrollTween = gsap.to(scroll, {
    scrollTop: Math.max(0, bottom > viewBottom ? bottom - scroll.clientHeight : top),
    duration: 0.42,
    ease: 'power2.inOut',
  })
}

function toggleExpanded(id) {
  setExpanded(expandedId.value === id ? null : id)
}

// 点击任意卡片以外的区域收起当前展开卡；点其它卡片交由该卡自身按钮处理（切换）。
// 卡片按钮的 @click 会先同步写好 expandedId 再冒泡到这里，故“点开卡片”那一下不会被误判成外部点击。
function handleOutsideClick(event) {
  // 点击确认删除按钮以外的任意处，撤销待确认状态。
  if (confirmingDeleteId.value && !event.target?.closest?.('.history-delete')) {
    clearDeleteConfirm()
  }

  if (!expandedId.value) {
    return
  }

  if (event.target?.closest?.('.history-card')) {
    return
  }

  setExpanded(null)
}

// 尊重系统的“减弱动效”偏好：命中时跳过一切 Flip/补间，直接切换展开态。
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  flipTween?.kill()
  flipTween = null
  scrollTween?.kill()
  scrollTween = null
  clearDeleteConfirm()
})

function isPackageRecord(item) {
  return item?.metadata?.recordType === 'image-package' || String(item?.status || '').startsWith('package_')
}

function isDeployRecord(item) {
  return item?.metadata?.recordType === 'remote-deployment' || String(item?.status || '').startsWith('deploy_')
}

function isFrontendRecord(item) {
  return item?.metadata?.recordType === 'frontend-upload' || String(item?.status || '').startsWith('frontend_')
}

function getRecordTitle(item) {
  if (isPackageRecord(item)) {
    return item.metadata?.serviceName || item.projectId || item.artifactName || '镜像打包记录'
  }

  if (isFrontendRecord(item)) {
    return item.metadata?.projectName || item.projectId || item.artifactName || '前端上传记录'
  }

  return item.metadata?.containerName || item.artifactName || item.projectId || '远程部署记录'
}

function getRecordSummary(item) {
  if (isPackageRecord(item)) {
    const imageRef = item.metadata?.imageRef || item.projectId || '-'
    const version = item.metadata?.serviceVersion || '-'
    return `${imageRef} · 版本 ${version}`
  }

  if (isFrontendRecord(item)) {
    const projectName = item.metadata?.projectName || item.projectId || '-'
    const remoteTargetDir = item.metadata?.remoteTargetDir || item.deployPath || '-'
    return `${projectName} · ${remoteTargetDir}`
  }

  const imageRef = item.metadata?.imageRef || item.projectId || '-'
  const remoteReleaseDir = item.metadata?.remoteReleaseDir || item.deployPath || '-'
  return `${imageRef} · ${remoteReleaseDir}`
}

function getDetailItems(item) {
  if (isPackageRecord(item)) {
    return [
      { label: '本地包', value: item.deployPath || '-' },
      { label: '镜像', value: item.metadata?.imageRef || item.projectId || '-' },
      { label: '模板', value: item.metadata?.dockerfileTemplateName || '-' },
      { label: 'Java', value: item.metadata?.javaVersion || '-' },
      { label: '基础镜像', value: item.metadata?.baseImage || '-' },
    ]
  }

  if (isFrontendRecord(item)) {
    return [
      { label: '远程包', value: item.remotePackagePath || item.metadata?.remoteArchivePath || '-' },
      { label: '发布目录', value: item.deployPath || item.metadata?.remoteTargetDir || '-' },
      { label: '策略', value: item.metadata?.extractStrategy || '-' },
      { label: '备份', value: item.metadata?.backupDir || '-' },
    ]
  }

  return [
    { label: '远程包', value: item.remotePackagePath || item.metadata?.remotePackagePath || '-' },
    { label: '发布目录', value: item.deployPath || item.metadata?.remoteReleaseDir || '-' },
    { label: 'Run 命令', value: item.runCommand || item.metadata?.runCommand || '-', command: true },
  ]
}

// 将原始状态字符串映射为中文标签 + 语义色（色彩只落在圆点上）。
function getStatusMeta(status) {
  const raw = String(status || '')

  if (['deploy_success', 'success', 'package_success', 'frontend_success'].includes(raw)) {
    return { label: successLabel(raw), tone: 'success' }
  }

  if (['deploy_failed', 'failed', 'package_failed', 'frontend_failed'].includes(raw)) {
    return { label: failedLabel(raw), tone: 'failed' }
  }

  return { label: raw || '处理中', tone: 'neutral' }
}

function successLabel(raw) {
  if (raw.startsWith('package')) {
    return '打包成功'
  }

  if (raw.startsWith('frontend')) {
    return '上传成功'
  }

  return '部署成功'
}

function failedLabel(raw) {
  if (raw.startsWith('package')) {
    return '打包失败'
  }

  if (raw.startsWith('frontend')) {
    return '上传失败'
  }

  return '部署失败'
}

// 时间戳统一格式化为 YYYY-MM-DD HH:mm，无法解析时回退原值。
function formatTime(value) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function clearDeleteConfirm() {
  confirmingDeleteId.value = ''
  if (confirmDeleteTimer) {
    clearTimeout(confirmDeleteTimer)
    confirmDeleteTimer = null
  }
}

// 首次点击进入确认态并起 3.5s 计时；确认态内再次点击才真正删除。
function requestDelete(id) {
  if (deletingDeploymentIds.value.includes(id)) {
    return
  }

  if (confirmingDeleteId.value === id) {
    clearDeleteConfirm()
    deleteDeploymentRecord(id)
    return
  }

  confirmingDeleteId.value = id
  if (confirmDeleteTimer) {
    clearTimeout(confirmDeleteTimer)
  }
  confirmDeleteTimer = setTimeout(() => {
    confirmingDeleteId.value = ''
    confirmDeleteTimer = null
  }, 3500)
}

async function copyValue(key, value) {
  if (!value || value === '-') {
    return
  }

  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedKey.value = ''
    }, 1400)
  } catch {
    // 剪贴板不可用时静默忽略，复制只是便利功能。
  }
}
</script>

<template>
  <section ref="pageRef" class="history-view">
    <div class="history-head">
      <div class="history-head-copy">
        <p class="eyebrow">Local Records</p>
        <h3>{{ activeTitle }}</h3>
      </div>
      <div class="history-switch">
        <span
          class="history-switch-thumb"
          :style="{ transform: `translateX(${switchIndex * 100}%)` }"
          aria-hidden="true"
        ></span>
        <button
          type="button"
          class="history-switch-button"
          :class="{ active: activeRecordType === 'deploy' }"
          @click="activeRecordType = 'deploy'"
        >
          部署记录
          <span class="history-switch-count">{{ deployRecords.length }}</span>
        </button>
        <button
          type="button"
          class="history-switch-button"
          :class="{ active: activeRecordType === 'frontend' }"
          @click="activeRecordType = 'frontend'"
        >
          前端上传
          <span class="history-switch-count">{{ frontendRecords.length }}</span>
        </button>
        <button
          type="button"
          class="history-switch-button"
          :class="{ active: activeRecordType === 'package' }"
          @click="activeRecordType = 'package'"
        >
          打包记录
          <span class="history-switch-count">{{ packageRecords.length }}</span>
        </button>
      </div>
    </div>

    <div v-if="!visibleRecords.length" class="history-empty">
      <strong>暂无记录</strong>
      <span>{{ activeEmptyText }}</span>
    </div>

    <template v-else>
      <div ref="scrollRef" class="history-scroll">
        <div ref="gridRef" class="history-grid">
          <article
            v-for="item in visibleRecords"
            :key="item.id"
            class="history-card"
            :class="{ open: expandedId === item.id }"
          >
            <button
              type="button"
              class="history-card-face"
              :aria-expanded="expandedId === item.id"
              @click="toggleExpanded(item.id)"
            >
              <span class="history-card-body">
                <strong class="history-card-title">{{ getRecordTitle(item) }}</strong>
                <small class="history-card-summary">{{ getRecordSummary(item) }}</small>
              </span>
              <span class="history-card-foot">
                <span class="history-status" :class="getStatusMeta(item.status).tone">
                  <span class="status-dot" :class="getStatusMeta(item.status).tone"></span>
                  {{ getStatusMeta(item.status).label }}
                </span>
                <span class="history-time">{{ formatTime(item.createdAt) }}</span>
              </span>
            </button>

            <button
              type="button"
              class="history-delete"
              :class="{ confirming: confirmingDeleteId === item.id }"
              :disabled="deletingDeploymentIds.includes(item.id)"
              :title="
                deletingDeploymentIds.includes(item.id)
                  ? '删除中…'
                  : confirmingDeleteId === item.id
                  ? '再次点击确认删除'
                  : '删除记录'
              "
              :aria-label="confirmingDeleteId === item.id ? '确认删除记录' : '删除记录'"
              @click.stop="requestDelete(item.id)"
            >
              <template v-if="confirmingDeleteId === item.id">
                <Trash2 :size="13" />
                确认
              </template>
              <Trash2 v-else :size="15" />
            </button>

            <div v-if="expandedId === item.id" class="history-drawer">
              <p v-if="item.errorSummary" class="history-error">
                <span class="history-error-tag">错误</span>
                <span class="history-error-text">{{ item.errorSummary }}</span>
              </p>

              <dl class="history-detail-grid">
                <template
                  v-for="detail in getDetailItems(item)"
                  :key="`${item.id}-${detail.label}`"
                >
                  <dt>{{ detail.label }}</dt>
                  <dd :class="{ command: detail.command }">
                    <template v-if="detail.command">
                      <pre class="history-command"><code>{{ detail.value }}</code></pre>
                      <button
                        type="button"
                        class="history-copy"
                        :title="copiedKey === `${item.id}-${detail.label}` ? '已复制' : '复制命令'"
                        @click.stop="copyValue(`${item.id}-${detail.label}`, detail.value)"
                      >
                        <Check v-if="copiedKey === `${item.id}-${detail.label}`" :size="13" />
                        <Copy v-else :size="13" />
                        {{ copiedKey === `${item.id}-${detail.label}` ? '已复制' : '复制' }}
                      </button>
                    </template>
                    <span v-else class="history-detail-text">{{ detail.value }}</span>
                  </dd>
                </template>
              </dl>
            </div>
          </article>
        </div>
      </div>

      <p class="history-foot">
        共 {{ visibleRecords.length }} 条 · 最近记录 {{ latestRecordTime }}
      </p>
    </template>
  </section>
</template>
