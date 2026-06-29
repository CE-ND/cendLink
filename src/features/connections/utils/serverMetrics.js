// 服务器资源探测：用一条组合命令一次读出 CPU / 内存 / 磁盘原始数据，
// 在渲染层解析成百分比和可读容量。复用 ssh.executeCommand，不改 Electron 主进程。

const SECTION_MARKERS = ['CPU1', 'CPU2', 'MEM', 'DISK']

/**
 * 构建资源探测命令。
 * - CPU 采两次 /proc/stat（间隔 0.7s）算使用率，而不是负载。
 * - 内存读 /proc/meminfo 的 MemTotal / MemAvailable。
 * - 磁盘读根分区 df。
 * 每段输出前用 marker 行分隔，方便解析；所有命令静默错误，单项失败不影响其他项。
 */
export function buildServerMetricsCommand() {
  return [
    "echo CPU1; grep '^cpu ' /proc/stat 2>/dev/null",
    'sleep 0.7',
    "echo CPU2; grep '^cpu ' /proc/stat 2>/dev/null",
    "echo MEM; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null",
    'echo DISK; df -P -k / 2>/dev/null | tail -1',
  ].join('; ')
}

/**
 * 解析探测命令输出，返回 { cpu, memory, disk }。
 * 任意一项无法解析时对应字段为 null，由界面降级展示。
 */
export function parseServerMetrics(stdout) {
  const sections = splitSections(stdout)

  return {
    cpu: parseCpu(sections.CPU1, sections.CPU2),
    memory: parseMemory(sections.MEM),
    disk: parseDisk(sections.DISK),
  }
}

/**
 * 按 marker 行把输出拆成各段。
 */
function splitSections(stdout) {
  const buckets = { CPU1: [], CPU2: [], MEM: [], DISK: [] }
  let current = null

  String(stdout || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((rawLine) => {
      const trimmed = rawLine.trim()

      if (SECTION_MARKERS.includes(trimmed)) {
        current = trimmed
        return
      }

      if (current && trimmed) {
        buckets[current].push(trimmed)
      }
    })

  return buckets
}

/**
 * 从两次 /proc/stat 采样计算 CPU 使用率。
 * total = 所有时间片之和；idle = idle + iowait；使用率 = 1 - idle 增量 / total 增量。
 */
function parseCpu(firstLines, secondLines) {
  const first = parseCpuSample(firstLines)
  const second = parseCpuSample(secondLines)

  if (!first || !second) {
    return null
  }

  const totalDelta = second.total - first.total
  const idleDelta = second.idle - first.idle

  if (totalDelta <= 0) {
    return null
  }

  return { percent: clampPercent(((totalDelta - idleDelta) / totalDelta) * 100) }
}

function parseCpuSample(lines) {
  const line = (lines || [])[0] || ''
  const parts = line.split(/\s+/)

  if (parts[0] !== 'cpu' || parts.length < 5) {
    return null
  }

  const nums = parts.slice(1).map((value) => Number(value) || 0)
  const idle = (nums[3] || 0) + (nums[4] || 0)
  const total = nums.reduce((sum, value) => sum + value, 0)

  return { idle, total }
}

/**
 * 已用内存 = MemTotal - MemAvailable。
 */
function parseMemory(lines) {
  const map = parseMeminfoKb(lines)
  const total = map.MemTotal

  if (!total) {
    return null
  }

  const used = Math.max(0, total - (map.MemAvailable || 0))

  return {
    percent: clampPercent((used / total) * 100),
    usedBytes: used * 1024,
    totalBytes: total * 1024,
    usedLabel: formatBytes(used * 1024),
    totalLabel: formatBytes(total * 1024),
  }
}

function parseMeminfoKb(lines) {
  const map = {}

  ;(lines || []).forEach((line) => {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/i)

    if (match) {
      map[match[1]] = Number(match[2])
    }
  })

  return map
}

/**
 * 解析 df -P -k / 的最后一行。
 * 字段：Filesystem 1024-blocks Used Available Capacity Mounted-on
 */
function parseDisk(lines) {
  const line = (lines || [])[0] || ''
  const parts = line.split(/\s+/)

  if (parts.length < 6) {
    return null
  }

  const totalKb = Number(parts[1]) || 0
  const usedKb = Number(parts[2]) || 0

  if (!totalKb) {
    return null
  }

  return {
    percent: clampPercent((usedKb / totalKb) * 100),
    usedBytes: usedKb * 1024,
    totalBytes: totalKb * 1024,
    usedLabel: formatBytes(usedKb * 1024),
    totalLabel: formatBytes(totalKb * 1024),
    mount: parts[5] || '/',
  }
}

/**
 * 把字节数格式化成人类可读容量。
 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0

  if (value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const scaled = value / 1024 ** exponent
  const digits = scaled >= 100 || exponent <= 1 ? 0 : 1

  return `${scaled.toFixed(digits)} ${units[exponent]}`
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return null
  }

  return Math.min(100, Math.max(0, Math.round(value)))
}
