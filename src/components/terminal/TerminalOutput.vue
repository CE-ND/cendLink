<script setup>
defineProps({
  lines: {
    type: Array,
    default: () => [],
  },
})
</script>

<template>
  <section class="terminal-panel" aria-label="连接日志">
    <header>
      <span>Connection Log</span>
      <small>{{ lines.length }} lines</small>
    </header>
    <pre><code>{{ lines.join('\n') }}</code></pre>
  </section>
</template>
