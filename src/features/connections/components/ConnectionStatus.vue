<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Terminal,
  ScrollText,
  Rocket,
  RotateCw,
} from '@lucide/vue'

// 展示最近一次 SSH 连接结果和远程环境探测信息。
const props = defineProps({
  // testConnection 返回的结果对象，包含 ok/status/message/remote/durationMs。
  result: {
    type: Object,
    default: null,
  },
  // 当前连接目标，用于横幅概要展示 user@host:port。
  target: {
    type: Object,
    default: () => ({}),
  },
  // 是否正在测试连接。
  busy: {
    type: Boolean,
    default: false,
  },
  // 表单已修改但尚未重新测试时为 true。
  stale: {
    type: Boolean,
    default: false,
  },
  // 服务器资源占用 { cpu, memory, disk }，由 useWorkspaceSession 提供。
  metrics: {
    type: Object,
    default: null,
  },
  // 资源数据读取中。
  metricsLoading: {
    type: Boolean,
    default: false,
  },
  // 资源数据读取错误信息。
  metricsError: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['refresh-metrics'])

const router = useRouter()

// 三个核心资源指标，转换成可直接渲染的卡片数据。
const metricTiles = computed(() => {
  const metrics = props.metrics || {}

  return [
    buildMetricTile('cpu', 'CPU', metrics.cpu, () => '处理器使用率'),
    buildMetricTile('memory', '内存', metrics.memory, (data) => `${data.usedLabel} / ${data.totalLabel}`),
    buildMetricTile('disk', '磁盘', metrics.disk, (data) => `${data.usedLabel} / ${data.totalLabel} · ${data.mount}`),
  ]
})

function buildMetricTile(key, label, data, detailFn) {
  const percent = data?.percent
  const hasValue = Number.isFinite(percent)

  return {
    key,
    label,
    percentLabel: hasValue ? `${percent}%` : '—',
    width: hasValue ? `${percent}%` : '0%',
    detail: hasValue ? detailFn(data) : '无法获取',
    tone: hasValue ? metricTone(percent) : 'empty',
  }
}

// 阈值染色：绿(<70) / 琥珀(70-90) / 红(>=90)，颜色承载健康度语义。
function metricTone(percent) {
  if (percent >= 90) {
    return 'danger'
  }

  if (percent >= 70) {
    return 'warn'
  }

  return 'ok'
}

// 横幅状态：成功 / 需重测 / 失败。
const bannerState = computed(() => {
  if (props.stale) {
    return 'warning'
  }

  return props.result?.ok ? 'success' : 'failed'
})

const bannerIcon = computed(() => {
  if (bannerState.value === 'success') {
    return CheckCircle2
  }

  return bannerState.value === 'warning' ? AlertTriangle : XCircle
})

const bannerTitle = computed(() => {
  if (bannerState.value === 'warning') {
    return '连接配置已变更'
  }

  return props.result?.message || (props.result?.ok ? '连接成功' : '连接失败')
})

// user@host:port 概要，优先用表单目标，回退到远程探测信息。
const targetSummary = computed(() => {
  const username = props.target?.username || props.result?.remote?.username || 'root'
  const host = props.target?.host || props.result?.remote?.hostname || '-'
  const port = props.target?.port || 22

  return `${username}@${host}:${port}`
})

// 身份信息 + 运行环境合并成一张无边框定义网格，按定义列表渲染而非卡片。
const serverInfoRows = computed(() => {
  const remote = props.result?.remote || {}

  return [
    { label: '用户', value: remote.username || '-', mono: true },
    { label: '主机', value: remote.hostname || '-', mono: true },
    { label: '目录', value: remote.workdir || '-', mono: true },
    { label: '系统', value: remote.system || '-' },
    { label: 'Java', value: remote.javaVersion || '-' },
  ]
})

const quickActions = [
  { label: '执行命令', routeName: 'commands', icon: Terminal },
  { label: '容器日志', routeName: 'containers', icon: ScrollText },
  { label: '去部署', routeName: 'deploy', icon: Rocket },
]

function goTo(routeName) {
  router.push({ name: routeName })
}
</script>

<template>
  <section class="status-panel">
    <div class="panel-header">
      <h3>连接状态</h3>
      <span
        class="state-pill"
        :class="{
          success: result?.ok && !stale,
          failed: result && !result.ok,
          warning: stale,
        }"
      >
        {{ busy ? 'Testing' : stale ? 'Retest Required' : result?.status || 'Idle' }}
      </span>
    </div>

    <div v-if="busy" class="status-empty">
      <strong>正在建立 SSH 连接</strong>
      <span>等待握手、认证和远程环境探测。</span>
    </div>

    <div v-else-if="!result" class="status-empty">
      <strong>尚未测试</strong>
      <span>填写服务器信息后执行一次连接测试。</span>
    </div>

    <div v-else class="status-result">
      <div class="status-banner" :class="bannerState">
        <component :is="bannerIcon" class="status-banner-icon" :size="26" aria-hidden="true" />
        <div class="status-banner-text">
          <strong>{{ bannerTitle }}</strong>
          <span>{{ targetSummary }} · 耗时 {{ result.durationMs }} ms</span>
        </div>
      </div>

      <p v-if="stale" class="result-message warning">
        当前结果仅供参考，请重新测试连接。
      </p>

      <div class="status-section">
        <p class="status-section-title">服务器信息</p>
        <dl class="info-grid">
          <div v-for="row in serverInfoRows" :key="row.label" class="info-row">
            <dt>{{ row.label }}</dt>
            <dd :class="{ mono: row.mono }" :title="row.value">{{ row.value }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="result.ok && !stale" class="status-section">
        <div class="status-section-head">
          <p class="status-section-title">服务器资源</p>
          <button
            class="metrics-refresh"
            type="button"
            :disabled="metricsLoading"
            @click="emit('refresh-metrics')"
          >
            <RotateCw :size="13" :class="{ spinning: metricsLoading }" aria-hidden="true" />
            {{ metricsLoading ? '读取中' : '刷新' }}
          </button>
        </div>

        <p v-if="metricsError" class="result-message warning">{{ metricsError }}</p>

        <div class="metric-tiles">
          <div
            v-for="tile in metricTiles"
            :key="tile.key"
            class="metric-tile"
            :class="tile.tone"
          >
            <div class="metric-tile-head">
              <span>{{ tile.label }}</span>
              <strong>{{ tile.percentLabel }}</strong>
            </div>
            <div class="metric-bar">
              <span :style="{ width: tile.width }"></span>
            </div>
            <small :title="tile.detail">{{ tile.detail }}</small>
          </div>
        </div>
      </div>

      <div v-if="result.ok && !stale" class="status-section">
        <p class="status-section-title">下一步</p>
        <div class="status-actions">
          <button
            v-for="action in quickActions"
            :key="action.routeName"
            type="button"
            class="status-action"
            @click="goTo(action.routeName)"
          >
            <component :is="action.icon" :size="16" aria-hidden="true" />
            <span>{{ action.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
