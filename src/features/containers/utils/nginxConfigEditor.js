let locationIdCounter = 0

export function nextLocationId() {
  return `location-${Date.now()}-${++locationIdCounter}`
}

export function serializeConfig(analysis) {
  if (!analysis) {
    return ''
  }

  const sections = []

  if (analysis.includes?.length) {
    analysis.includes.forEach((inc) => {
      sections.push(`include ${inc};`)
    })
    sections.push('')
  }

  analysis.servers.forEach((server) => {
    sections.push(serializeServerBlock(server))
  })

  return sections.join('\n')
}

export function serializeServerBlock(server) {
  const lines = []

  if (server.title && !isAutoTitle(server.title)) {
    lines.push(`# ${server.title}`)
  }

  lines.push('server {')

  server.listens.forEach((listen) => {
    lines.push(`    listen ${listen};`)
  })

  if (server.serverNames.length) {
    lines.push(`    server_name ${server.serverNames.join(' ')};`)
  }

  if (server.clientMaxBodySize) {
    lines.push(`    client_max_body_size ${server.clientMaxBodySize};`)
  }

  server.returns.forEach((ret) => {
    lines.push(`    return ${ret};`)
  })

  if (server.sslCertificates?.length) {
    server.sslCertificates.forEach((cert) => {
      lines.push(`    ssl_certificate ${cert};`)
    })
  }

  if (server.sslCertificateKeys?.length) {
    server.sslCertificateKeys.forEach((key) => {
      lines.push(`    ssl_certificate_key ${key};`)
    })
  }

  if (server.locations.length) {
    lines.push('')
    server.locations.forEach((location) => {
      lines.push(serializeLocationBlock(location))
    })
  }

  lines.push('}')

  return lines.join('\n')
}

export function serializeLocationBlock(location) {
  const lines = []
  const header = buildLocationHeader(location)

  if (location.title && !isAutoTitle(location.title)) {
    lines.push(`        # ${location.title}`)
  }

  lines.push(`    location ${header} {`)

  if (location.root) {
    lines.push(`        root ${location.root};`)
  }

  if (location.alias) {
    lines.push(`        alias ${location.alias};`)
  }

  if (location.indexes?.length) {
    lines.push(`        index ${location.indexes.join(' ')};`)
  }

  if (location.tryFiles?.length) {
    lines.push(`        try_files ${location.tryFiles.join(' ')};`)
  }

  if (location.proxyPass) {
    lines.push(`        proxy_pass ${location.proxyPass};`)
  }

  if (location.proxyHttpVersion) {
    lines.push(`        proxy_http_version ${location.proxyHttpVersion};`)
  }

  if (location.proxyBuffering) {
    lines.push(`        proxy_buffering ${location.proxyBuffering};`)
  }

  if (location.proxyHeaders?.length) {
    location.proxyHeaders.forEach((header) => {
      lines.push(`        proxy_set_header ${header.name} ${header.value};`)
    })
  }

  if (location.timeouts?.length) {
    location.timeouts.forEach((timeout) => {
      lines.push(`        ${timeout.name} ${timeout.value};`)
    })
  }

  if (location.clientMaxBodySize) {
    lines.push(`        client_max_body_size ${location.clientMaxBodySize};`)
  }

  location.returns.forEach((ret) => {
    lines.push(`        return ${ret};`)
  })

  lines.push('    }')

  return lines.join('\n')
}

function buildLocationHeader(location) {
  const parts = []

  if (location.matcher) {
    parts.push(location.matcher)
  }

  parts.push(location.path || '/')

  return parts.join(' ')
}

function isAutoTitle(title) {
  return /^Server \d+$/.test(title) || /^Location \d+$/.test(title)
}

export function addLocationToServer(analysis, serverId, locationTemplate) {
  const server = analysis.servers.find((s) => s.id === serverId)

  if (!server) {
    return analysis
  }

  const newLocation = {
    id: nextLocationId(),
    title: locationTemplate.title || '',
    matcher: locationTemplate.matcher || '',
    path: locationTemplate.path || '/',
    kind: locationTemplate.kind || 'static',
    proxyPass: locationTemplate.proxyPass || '',
    root: locationTemplate.root || '',
    alias: locationTemplate.alias || '',
    returns: locationTemplate.returns || [],
    indexes: locationTemplate.indexes || [],
    tryFiles: locationTemplate.tryFiles || [],
    clientMaxBodySize: locationTemplate.clientMaxBodySize || '',
    proxyHeaders: locationTemplate.proxyHeaders || [],
    proxyHttpVersion: locationTemplate.proxyHttpVersion || '',
    proxyBuffering: locationTemplate.proxyBuffering || '',
    timeouts: locationTemplate.timeouts || [],
  }

  return {
    ...analysis,
    servers: analysis.servers.map((s) => {
      if (s.id !== serverId) {
        return s
      }

      return {
        ...s,
        locations: [...s.locations, newLocation],
        flags: {
          ...s.flags,
          proxy: s.flags.proxy || newLocation.kind === 'proxy' || newLocation.kind === 'websocket',
          static: s.flags.static || newLocation.kind === 'static' || newLocation.kind === 'spa',
          websocket: s.flags.websocket || newLocation.kind === 'websocket',
        },
      }
    }),
  }
}

export function removeLocationFromServer(analysis, serverId, locationId) {
  return {
    ...analysis,
    servers: analysis.servers.map((s) => {
      if (s.id !== serverId) {
        return s
      }

      const remaining = s.locations.filter((loc) => loc.id !== locationId)

      return {
        ...s,
        locations: remaining,
        flags: {
          ...s.flags,
          proxy: remaining.some((loc) => loc.kind === 'proxy' || loc.kind === 'websocket'),
          static: remaining.some((loc) => loc.kind === 'static' || loc.kind === 'spa'),
          websocket: remaining.some((loc) => loc.kind === 'websocket'),
        },
      }
    }),
  }
}

export function updateLocationInServer(analysis, serverId, locationId, patch) {
  return {
    ...analysis,
    servers: analysis.servers.map((s) => {
      if (s.id !== serverId) {
        return s
      }

      return {
        ...s,
        locations: s.locations.map((loc) => {
          if (loc.id !== locationId) {
            return loc
          }

          return { ...loc, ...patch }
        }),
      }
    }),
  }
}

export function addServerToConfig(analysis) {
  const newServer = {
    id: `new-${Date.now()}`,
    title: 'New Server',
    line: 0,
    listens: ['80'],
    serverNames: [],
    returns: [],
    sslCertificates: [],
    sslCertificateKeys: [],
    clientMaxBodySize: '',
    locations: [],
    flags: {
      https: false,
      redirect: false,
      proxy: false,
      static: false,
      websocket: false,
    },
  }

  return {
    ...analysis,
    servers: [...analysis.servers, newServer],
    counts: {
      ...analysis.counts,
      servers: analysis.counts.servers + 1,
    },
  }
}

export function removeServerFromConfig(analysis, serverId) {
  const target = analysis.servers.find((s) => s.id === serverId)

  return {
    ...analysis,
    servers: analysis.servers.filter((s) => s.id !== serverId),
    counts: {
      ...analysis.counts,
      servers: Math.max(0, analysis.counts.servers - 1),
      locations: analysis.counts.locations - (target?.locations.length || 0),
    },
  }
}

// 差异预览中，每个变更块前后保留的上下文行数。
const DIFF_CONTEXT_LINES = 3
// 行数过多时跳过 O(n*m) 的 LCS 计算，避免界面卡顿。nginx 配置极少超过此规模。
const DIFF_MAX_LINES = 6000

/**
 * 对比两份配置文本，输出可逐行高亮的差异结果。
 *
 * 采用 LCS（最长公共子序列）算法，正确处理行的新增 / 删除导致的行号偏移，
 * 因此能精确标出"哪一行变了"，而不是位置错位后把整段都标成变更。
 *
 * 返回结构：
 * - rows：完整的逐行差异（type: equal/add/remove，附原文件与新文件行号）。
 * - hunks：按变更点聚合、带上下文行的差异块，供模态框分块渲染。
 * - addedCount/removedCount：新增、删除的行数，用于标题摘要。
 */
export function diffConfigs(oldContent, newContent) {
  const oldText = normalizeDiffContent(oldContent)
  const newText = normalizeDiffContent(newContent)
  const oldLines = splitDiffLines(oldText)
  const newLines = splitDiffLines(newText)

  const rows = computeLineDiff(oldLines, newLines)
  const hunks = groupDiffHunks(rows, DIFF_CONTEXT_LINES)
  const previewRows = buildPreviewRows(rows)
  const changedRows = hunks.flatMap((hunk) => hunk.sideRows.filter((row) => row.type !== 'equal'))
  const addedCount = changedRows.filter((row) => row.type === 'add').length
  const removedCount = changedRows.filter((row) => row.type === 'remove').length
  const modifiedCount = changedRows.filter((row) => row.type === 'change').length
  const changedLineCount = changedRows.length

  return {
    same: changedLineCount === 0,
    rows,
    hunks,
    previewRows,
    addedCount,
    removedCount,
    modifiedCount,
    changedLineCount,
    changedBlockCount: hunks.length,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
  }
}

function normalizeDiffContent(content) {
  return String(content ?? '').replace(/\r\n?/g, '\n')
}

function splitDiffLines(content) {
  return content.split('\n')
}

/**
 * 基于 LCS 的逐行 diff，回溯出 equal / remove / add 的行序列。
 * 行数超过阈值时退化为按位置对比，保证不阻塞界面。
 */
function computeLineDiff(oldLines, newLines) {
  const n = oldLines.length
  const m = newLines.length

  if (n > DIFF_MAX_LINES || m > DIFF_MAX_LINES) {
    return positionalDiff(oldLines, newLines)
  }

  // lcs[i][j] = oldLines[i..] 与 newLines[j..] 的最长公共子序列长度。
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push(makeDiffRow('equal', i + 1, j + 1, oldLines[i]))
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push(makeDiffRow('remove', i + 1, null, oldLines[i]))
      i++
    } else {
      rows.push(makeDiffRow('add', null, j + 1, newLines[j]))
      j++
    }
  }

  while (i < n) {
    rows.push(makeDiffRow('remove', i + 1, null, oldLines[i]))
    i++
  }

  while (j < m) {
    rows.push(makeDiffRow('add', null, j + 1, newLines[j]))
    j++
  }

  return rows
}

/**
 * 超大文件的兜底：按行号位置直接对比，行数不同的尾部记为新增 / 删除。
 */
function positionalDiff(oldLines, newLines) {
  const rows = []
  const maxLen = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : null
    const newLine = i < newLines.length ? newLines[i] : null

    if (oldLine !== null && newLine !== null && oldLine === newLine) {
      rows.push(makeDiffRow('equal', i + 1, i + 1, oldLine))
      continue
    }

    if (oldLine !== null) {
      rows.push(makeDiffRow('remove', i + 1, null, oldLine))
    }

    if (newLine !== null) {
      rows.push(makeDiffRow('add', null, i + 1, newLine))
    }
  }

  return rows
}

function makeDiffRow(type, oldNumber, newNumber, text) {
  return { type, oldNumber, newNumber, text }
}

function buildPreviewRows(rows) {
  const previewRows = []
  let idx = 0
  let deletedAnchor = 0

  while (idx < rows.length) {
    const row = rows[idx]

    if (row.type === 'equal') {
      previewRows.push(makePreviewRow({
        type: 'equal',
        newNumber: row.newNumber,
        oldNumber: row.oldNumber,
        text: row.text,
      }))
      deletedAnchor = row.newNumber
      idx++
      continue
    }

    if (row.type === 'remove') {
      const removed = []
      const added = []

      while (idx < rows.length && rows[idx].type === 'remove') {
        removed.push(rows[idx])
        idx++
      }

      while (idx < rows.length && rows[idx].type === 'add') {
        added.push(rows[idx])
        idx++
      }

      const maxLen = Math.max(removed.length, added.length)

      for (let lineIdx = 0; lineIdx < maxLen; lineIdx++) {
        const oldLine = removed[lineIdx]
        const newLine = added[lineIdx]

        if (oldLine && newLine) {
          const { oldParts, newParts } = diffLineParts(oldLine.text, newLine.text)

          previewRows.push(makePreviewRow({
            type: 'change',
            oldNumber: oldLine.oldNumber,
            newNumber: newLine.newNumber,
            oldText: oldLine.text,
            text: newLine.text,
            oldParts,
            parts: newParts,
          }))
          deletedAnchor = newLine.newNumber
          continue
        }

        if (oldLine) {
          previewRows.push(makePreviewRow({
            type: 'remove',
            oldNumber: oldLine.oldNumber,
            anchorNumber: deletedAnchor,
            oldText: oldLine.text,
            text: oldLine.text,
          }))
          continue
        }

        previewRows.push(makePreviewRow({
          type: 'add',
          newNumber: newLine.newNumber,
          text: newLine.text,
        }))
        deletedAnchor = newLine.newNumber
      }

      continue
    }

    previewRows.push(makePreviewRow({
      type: 'add',
      newNumber: row.newNumber,
      text: row.text,
    }))
    deletedAnchor = row.newNumber
    idx++
  }

  return previewRows
}

function makePreviewRow({
  type,
  oldNumber = null,
  newNumber = null,
  anchorNumber = null,
  text = '',
  oldText = '',
  parts = null,
  oldParts = null,
}) {
  return {
    type,
    oldNumber,
    newNumber,
    anchorNumber,
    text,
    oldText,
    parts: parts || [{ text, changed: type === 'add' || type === 'remove' }],
    oldParts: oldParts || [{ text: oldText, changed: type === 'remove' }],
  }
}

/**
 * 把逐行差异聚合成带上下文的差异块：
 * 只保留每个变更行前后 context 行，连续保留区合并为一个 hunk。
 */
function groupDiffHunks(rows, context) {
  const total = rows.length
  const keep = new Array(total).fill(false)
  let hasChange = false

  for (let idx = 0; idx < total; idx++) {
    if (rows[idx].type === 'equal') {
      continue
    }

    hasChange = true
    const from = Math.max(0, idx - context)
    const to = Math.min(total - 1, idx + context)

    for (let k = from; k <= to; k++) {
      keep[k] = true
    }
  }

  if (!hasChange) {
    return []
  }

  const hunks = []
  let idx = 0

  while (idx < total) {
    if (!keep[idx]) {
      idx++
      continue
    }

    let end = idx
    while (end < total && keep[end]) {
      end++
    }

    hunks.push(buildDiffHunk(rows.slice(idx, end)))
    idx = end
  }

  return hunks
}

function buildDiffHunk(lines) {
  const oldNumbers = lines.map((line) => line.oldNumber).filter((value) => value !== null)
  const newNumbers = lines.map((line) => line.newNumber).filter((value) => value !== null)
  const oldStart = oldNumbers[0] ?? 0
  const newStart = newNumbers[0] ?? 0
  const oldCount = oldNumbers.length
  const newCount = newNumbers.length
  const sideRows = buildSideBySideRows(lines)
  const changeCount = sideRows.filter((row) => row.type !== 'equal').length

  return {
    header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    oldStart,
    oldCount,
    newStart,
    newCount,
    oldRangeLabel: formatDiffRange(oldStart, oldCount),
    newRangeLabel: formatDiffRange(newStart, newCount),
    changeCount,
    lines,
    sideRows,
  }
}

function buildSideBySideRows(lines) {
  const rows = []
  let idx = 0

  while (idx < lines.length) {
    const line = lines[idx]

    if (line.type === 'equal') {
      rows.push(makeSideBySideRow({
        type: 'equal',
        oldNumber: line.oldNumber,
        newNumber: line.newNumber,
        oldText: line.text,
        newText: line.text,
      }))
      idx++
      continue
    }

    if (line.type === 'remove') {
      const removed = []
      const added = []

      while (idx < lines.length && lines[idx].type === 'remove') {
        removed.push(lines[idx])
        idx++
      }

      while (idx < lines.length && lines[idx].type === 'add') {
        added.push(lines[idx])
        idx++
      }

      const maxLen = Math.max(removed.length, added.length)

      for (let lineIdx = 0; lineIdx < maxLen; lineIdx++) {
        const oldLine = removed[lineIdx]
        const newLine = added[lineIdx]

        if (oldLine && newLine) {
          const { oldParts, newParts } = diffLineParts(oldLine.text, newLine.text)

          rows.push(makeSideBySideRow({
            type: 'change',
            oldNumber: oldLine.oldNumber,
            newNumber: newLine.newNumber,
            oldText: oldLine.text,
            newText: newLine.text,
            oldParts,
            newParts,
          }))
          continue
        }

        if (oldLine) {
          rows.push(makeSideBySideRow({
            type: 'remove',
            oldNumber: oldLine.oldNumber,
            oldText: oldLine.text,
          }))
          continue
        }

        rows.push(makeSideBySideRow({
          type: 'add',
          newNumber: newLine.newNumber,
          newText: newLine.text,
        }))
      }

      continue
    }

    rows.push(makeSideBySideRow({
      type: 'add',
      newNumber: line.newNumber,
      newText: line.text,
    }))
    idx++
  }

  return rows
}

function makeSideBySideRow({
  type,
  oldNumber = null,
  newNumber = null,
  oldText = '',
  newText = '',
  oldParts = null,
  newParts = null,
}) {
  return {
    type,
    oldNumber,
    newNumber,
    oldText,
    newText,
    oldParts: oldParts || [{ text: oldText, changed: type === 'remove' }],
    newParts: newParts || [{ text: newText, changed: type === 'add' }],
  }
}

function diffLineParts(oldText = '', newText = '') {
  if (oldText === newText) {
    const parts = [{ text: oldText, changed: false }]
    return { oldParts: parts, newParts: parts }
  }

  let prefixLen = 0
  const maxPrefix = Math.min(oldText.length, newText.length)

  while (prefixLen < maxPrefix && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++
  }

  let suffixLen = 0
  const oldRemain = oldText.length - prefixLen
  const newRemain = newText.length - prefixLen
  const maxSuffix = Math.min(oldRemain, newRemain)

  while (
    suffixLen < maxSuffix &&
    oldText[oldText.length - suffixLen - 1] === newText[newText.length - suffixLen - 1]
  ) {
    suffixLen++
  }

  return {
    oldParts: splitLineParts(oldText, prefixLen, suffixLen),
    newParts: splitLineParts(newText, prefixLen, suffixLen),
  }
}

function splitLineParts(text, prefixLen, suffixLen) {
  const parts = []
  const changedEnd = text.length - suffixLen

  if (prefixLen > 0) {
    parts.push({ text: text.slice(0, prefixLen), changed: false })
  }

  parts.push({ text: text.slice(prefixLen, changedEnd), changed: true })

  if (suffixLen > 0) {
    parts.push({ text: text.slice(changedEnd), changed: false })
  }

  return parts.filter((part) => part.text.length > 0)
}

function formatDiffRange(start, count) {
  if (!start || count <= 0) {
    return '-'
  }

  if (count === 1) {
    return String(start)
  }

  return `${start}-${start + count - 1}`
}
