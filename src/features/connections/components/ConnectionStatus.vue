<script setup>
// 展示最近一次 SSH 连接结果和远程环境探测信息。
defineProps({
  result: {
    type: Object,
    default: null,
  },
  busy: {
    type: Boolean,
    default: false,
  },
  stale: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <section class="panel status-panel">
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

    <div v-else class="result-block">
      <p v-if="stale" class="result-message warning">
        连接配置已变更，当前结果仅供参考，请重新测试。
      </p>
      <p class="result-message" :class="{ ok: result.ok && !stale }">{{ result.message }}</p>

      <dl class="meta-grid">
        <div>
          <dt>耗时</dt>
          <dd>{{ result.durationMs }} ms</dd>
        </div>
        <div>
          <dt>用户</dt>
          <dd>{{ result.remote?.username || '-' }}</dd>
        </div>
        <div>
          <dt>主机</dt>
          <dd>{{ result.remote?.hostname || '-' }}</dd>
        </div>
        <div>
          <dt>目录</dt>
          <dd>{{ result.remote?.workdir || '-' }}</dd>
        </div>
        <div class="wide">
          <dt>系统</dt>
          <dd>{{ result.remote?.system || '-' }}</dd>
        </div>
        <div class="wide">
          <dt>Java</dt>
          <dd>{{ result.remote?.javaVersion || '-' }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
