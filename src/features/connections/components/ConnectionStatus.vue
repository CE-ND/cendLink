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
})

const router = useRouter()

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

const identityDetails = computed(() => [
  { label: '用户', value: props.result?.remote?.username || '-' },
  { label: '主机', value: props.result?.remote?.hostname || '-' },
  { label: '目录', value: props.result?.remote?.workdir || '-' },
])

const environmentDetails = computed(() => [
  { label: '系统', value: props.result?.remote?.system || '-' },
  { label: 'Java', value: props.result?.remote?.javaVersion || '-' },
])

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
      <div>
        <p class="eyebrow">Connection State</p>
        <h3>连接状态</h3>
      </div>
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
        <p class="status-section-title">身份信息</p>
        <dl class="meta-grid">
          <div v-for="item in identityDetails" :key="item.label" class="meta-row">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </div>

      <div class="status-section">
        <p class="status-section-title">运行环境</p>
        <dl class="meta-grid">
          <div v-for="item in environmentDetails" :key="item.label" class="meta-row">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
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
