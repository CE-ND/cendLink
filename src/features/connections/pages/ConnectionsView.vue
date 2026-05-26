<script setup>
import { computed, reactive, ref } from 'vue'
import ConnectionForm from '../components/ConnectionForm.vue'
import ConnectionStatus from '../components/ConnectionStatus.vue'
import TerminalOutput from '../../../components/terminal/TerminalOutput.vue'

const form = reactive({
  name: '默认服务器',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  timeoutMs: 10000,
})

const result = ref(null)
const isTesting = ref(false)
const logs = ref([
  line('连接模块已就绪'),
  line('通过 Electron 启动后，可以执行真实 SSH 连接测试'),
])

const hasElectronBridge = computed(() => {
  return Boolean(window.cendlink?.ssh?.testConnection)
})

async function testConnection() {
  if (isTesting.value) {
    return
  }

  result.value = null
  isTesting.value = true
  logs.value = [line(`开始测试 ${form.username}@${form.host || '未填写 Host'}:${form.port}`)]

  if (!hasElectronBridge.value) {
    result.value = {
      ok: false,
      status: 'failed',
      message: '当前是浏览器预览模式，无法调用 Electron SSH 能力',
      durationMs: 0,
    }
    logs.value.push(line('请先运行 npm run dev，再运行 npm run electron:dev'))
    isTesting.value = false
    return
  }

  try {
    const response = await window.cendlink.ssh.testConnection({ ...form })
    result.value = response
    logs.value = response.logs?.length ? response.logs : [line(response.message)]
  } catch (error) {
    result.value = {
      ok: false,
      status: 'failed',
      message: error?.message || '连接测试失败',
      durationMs: 0,
    }
    logs.value.push(line(result.value.message))
  } finally {
    isTesting.value = false
  }
}

async function selectPrivateKeyFile() {
  if (!hasElectronBridge.value || !window.cendlink?.ssh?.selectPrivateKeyFile) {
    logs.value.push(line('当前是浏览器预览模式，无法打开本地文件选择器'))
    return
  }

  const selected = await window.cendlink.ssh.selectPrivateKeyFile()

  if (selected?.canceled || !selected?.filePath) {
    logs.value.push(line('已取消选择 PEM / 私钥文件'))
    return
  }

  updateForm({
    ...form,
    authType: 'privateKey',
    privateKeyPath: selected.filePath,
  })
  logs.value.push(line('已导入 PEM / 私钥文件路径'))
}

function updateForm(value) {
  Object.assign(form, value)
}

function line(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  return `[${time}] ${message}`
}
</script>

<template>
  <main class="connection-page">
    <aside class="sidebar">
      <div>
        <p class="eyebrow">CendLink</p>
        <h1>远程连接</h1>
      </div>

      <nav class="nav-list" aria-label="主导航">
        <button class="nav-item active" type="button">服务器</button>
        <button class="nav-item" type="button">项目</button>
        <button class="nav-item" type="button">部署记录</button>
        <button class="nav-item" type="button">设置</button>
      </nav>

      <section class="server-list" aria-label="服务器列表">
        <div class="server-row selected">
          <span class="status-dot"></span>
          <div>
            <strong>{{ form.name }}</strong>
            <small>{{ form.host || '等待填写 Host' }}</small>
          </div>
        </div>
      </section>
    </aside>

    <section class="workspace">
      <header class="workspace-header">
        <div>
          <p class="eyebrow">SSH Connection</p>
          <h2>连接测试</h2>
        </div>
        <span class="bridge-badge" :class="{ ready: hasElectronBridge }">
          {{ hasElectronBridge ? 'Electron 已连接' : '浏览器预览' }}
        </span>
      </header>

      <div class="content-grid">
        <ConnectionForm
          :model-value="form"
          :busy="isTesting"
          @update:model-value="updateForm"
          @select-key="selectPrivateKeyFile"
          @test="testConnection"
        />
        <ConnectionStatus :result="result" :busy="isTesting" />
      </div>

      <TerminalOutput :lines="logs" />
    </section>
  </main>
</template>
