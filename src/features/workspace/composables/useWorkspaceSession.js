import { computed, reactive, ref } from 'vue'

// 渲染进程共享会话状态。各个页面通过它复用 SSH 上下文，避免切页后状态丢失。
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
const commandResult = ref(null)
const commandText = ref('')
const isTesting = ref(false)
const isExecutingCommand = ref(false)
const lastTestedSnapshot = ref('')
const logs = ref([
  logLine('连接模块已就绪'),
  logLine('通过 Electron 启动后，可以执行真实 SSH 连接测试和远程命令'),
])

const hasElectronBridge = computed(() => {
  const ssh = getSshBridge()

  return Boolean(ssh?.testConnection && ssh?.executeCommand && ssh?.selectPrivateKeyFile)
})

const currentConnectionSnapshot = computed(() => {
  return JSON.stringify({
    host: form.host.trim(),
    port: Number(form.port || 22),
    username: form.username.trim(),
    authType: form.authType,
    password: form.password,
    privateKeyPath: form.privateKeyPath.trim(),
    passphrase: form.passphrase,
    timeoutMs: Number(form.timeoutMs || 10000),
  })
})

const needsRetest = computed(() => {
  return Boolean(lastTestedSnapshot.value) && lastTestedSnapshot.value !== currentConnectionSnapshot.value
})

const canExecuteCommand = computed(() => {
  return Boolean(
    hasElectronBridge.value &&
      result.value?.ok &&
      !needsRetest.value &&
      !isTesting.value &&
      !isExecutingCommand.value,
  )
})

const commandHint = computed(() => {
  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再执行远程命令。'
  }

  if (isTesting.value) {
    return '连接测试进行中，请等待测试结果。'
  }

  if (!result.value?.ok) {
    return '请先测试连接，连接成功后再执行命令。'
  }

  if (needsRetest.value) {
    return '服务器连接信息已变更，请重新测试连接。'
  }

  if (isExecutingCommand.value) {
    return '命令执行中，请等待服务器返回结果。'
  }

  return '支持一次性 Linux 命令，例如 pwd、ls -la /opt/app、systemctl status my-service。'
})

function updateForm(nextValue) {
  const previousSnapshot = currentConnectionSnapshot.value

  Object.assign(form, nextValue)

  if (previousSnapshot !== currentConnectionSnapshot.value) {
    commandResult.value = null
  }
}

function updateCommandText(value) {
  commandText.value = value
}

async function testConnection() {
  if (isTesting.value) {
    return
  }

  const ssh = getSshBridge()

  result.value = null
  commandResult.value = null
  lastTestedSnapshot.value = ''
  isTesting.value = true
  logs.value = [logLine(`开始测试 ${form.username}@${form.host || '未填写 Host'}:${form.port}`)]

  if (!ssh?.testConnection) {
    result.value = {
      ok: false,
      status: 'failed',
      message: '当前是浏览器预览模式，无法调用 Electron SSH 能力',
      durationMs: 0,
    }
    logs.value.push(logLine('请先运行 npm run dev:electron'))
    isTesting.value = false
    return
  }

  try {
    const response = await ssh.testConnection({ ...form })

    result.value = response
    commandResult.value = null
    lastTestedSnapshot.value = currentConnectionSnapshot.value
    logs.value = response.logs?.length ? response.logs : [logLine(response.message)]
  } catch (error) {
    result.value = {
      ok: false,
      status: 'failed',
      message: error?.message || '连接测试失败',
      durationMs: 0,
    }
    lastTestedSnapshot.value = currentConnectionSnapshot.value
    logs.value.push(logLine(result.value.message))
  } finally {
    isTesting.value = false
  }
}

async function executeCommand() {
  if (!canExecuteCommand.value) {
    return
  }

  const ssh = getSshBridge()
  const command = commandText.value.trim()

  if (!command) {
    commandResult.value = {
      ok: false,
      status: 'failed',
      message: '请输入要执行的 Linux 命令',
      exitCode: null,
      durationMs: 0,
    }
    return
  }

  if (!ssh?.executeCommand) {
    commandResult.value = {
      ok: false,
      status: 'failed',
      command,
      message: '当前是浏览器预览模式，无法调用 Electron SSH 能力',
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
    }
    return
  }

  isExecutingCommand.value = true

  try {
    const response = await ssh.executeCommand({ ...form }, command)

    commandResult.value = response
    appendCommandOutput(response)
  } catch (error) {
    const failure = {
      ok: false,
      status: 'failed',
      command,
      message: error?.message || '命令执行失败',
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
    }

    commandResult.value = failure
    appendCommandOutput(failure)
  } finally {
    isExecutingCommand.value = false
  }
}

async function selectPrivateKeyFile() {
  const ssh = getSshBridge()

  if (!ssh?.selectPrivateKeyFile) {
    logs.value.push(logLine('当前是浏览器预览模式，无法打开本地文件选择器'))
    return
  }

  const selected = await ssh.selectPrivateKeyFile()

  if (selected?.canceled || !selected?.filePath) {
    logs.value.push(logLine('已取消选择 PEM / 私钥文件'))
    return
  }

  updateForm({
    ...form,
    authType: 'privateKey',
    privateKeyPath: selected.filePath,
  })
  logs.value.push(logLine('已导入 PEM / 私钥文件路径'))
}

function clearLogs() {
  logs.value = []
}

function appendCommandOutput(response) {
  const nextLines = [...logs.value]
  const command = response.command || commandText.value.trim()

  if (nextLines.length) {
    nextLines.push('')
  }

  nextLines.push(logLine(`命令执行结束: ${summarizeCommand(command)}`))
  nextLines.push(...formatCommandLines(command))

  if (response.stdout) {
    nextLines.push(...toDisplayLines(response.stdout))
  }

  if (response.stderr) {
    if (response.stdout) {
      nextLines.push('')
    }

    nextLines.push('[stderr]')
    nextLines.push(...toDisplayLines(response.stderr))
  }

  if (!response.stdout && !response.stderr) {
    nextLines.push('[no output]')
  }

  nextLines.push(
    `[exit code] ${response.exitCode ?? '-'} | [duration] ${response.durationMs ?? 0} ms`,
  )

  logs.value = nextLines
}

function getSshBridge() {
  return globalThis.window?.cendlink?.ssh ?? null
}

function formatCommandLines(command) {
  return command.split(/\r?\n/).map((lineContent, index) => {
    return `${index === 0 ? '$' : '>'} ${lineContent}`
  })
}

function summarizeCommand(command) {
  return command.replace(/\s+/g, ' ').slice(0, 80)
}

function toDisplayLines(output) {
  return output.replace(/\r\n/g, '\n').split('\n')
}

function logLine(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  return `[${time}] ${message}`
}

export function useWorkspaceSession() {
  return {
    form,
    result,
    commandResult,
    commandText,
    isTesting,
    isExecutingCommand,
    logs,
    hasElectronBridge,
    needsRetest,
    canExecuteCommand,
    commandHint,
    updateForm,
    updateCommandText,
    testConnection,
    executeCommand,
    selectPrivateKeyFile,
    clearLogs,
  }
}
