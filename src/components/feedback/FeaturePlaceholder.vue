<script setup>
// 通用占位卡片，用于承接已经进入壳层但尚未实现的导航页面。
defineProps({
  eyebrow: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
})
</script>

<template>
  <section class="panel placeholder-panel">
    <p class="eyebrow">{{ eyebrow }}</p>
    <h3>{{ title }}</h3>
    <p class="placeholder-copy">{{ description }}</p>
  </section>
</template>
