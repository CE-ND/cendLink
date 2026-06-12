const SECTION_COMMENT_RE = /^[#\s=\-【】\[\]<>:：.0-9]+|[#\s=\-]+$/g

export function parseNginxConfig(content = '', meta = {}) {
  const source = normalizeNewlines(content)
  const serverBlocks = findNamedBlocks(source, 'server')
  const servers = serverBlocks.map((block, index) => parseServerBlock(source, block, index))
  const includes = parseDirectiveValues(maskNestedBlocks(source), 'include')

  return {
    path: meta.path || '',
    name: meta.name || '',
    content: source,
    includes,
    servers,
    lineCount: source ? source.split('\n').length : 0,
    size: source.length,
    counts: buildConfigCounts(servers),
  }
}

export function summarizeNginxConfigFiles(files = []) {
  const analyses = files.map((file) => file.analysis).filter(Boolean)
  const totals = analyses.reduce(
    (result, analysis) => {
      result.files += 1
      result.servers += analysis.counts.servers
      result.locations += analysis.counts.locations
      result.https += analysis.counts.https
      result.redirects += analysis.counts.redirects
      result.proxies += analysis.counts.proxies
      result.staticSites += analysis.counts.staticSites
      result.websockets += analysis.counts.websockets
      return result
    },
    {
      files: 0,
      servers: 0,
      locations: 0,
      https: 0,
      redirects: 0,
      proxies: 0,
      staticSites: 0,
      websockets: 0,
    },
  )

  return totals
}

function parseServerBlock(source, block, index) {
  const body = block.body
  const topLevel = maskNestedBlocks(body)
  const listens = parseDirectiveValues(topLevel, 'listen')
  const serverNames = parseDirectiveValues(topLevel, 'server_name')
    .flatMap((value) => splitDirectiveArgs(value))
    .filter(Boolean)
  const returns = parseDirectiveValues(topLevel, 'return')
  const sslCertificates = parseDirectiveValues(topLevel, 'ssl_certificate')
  const sslCertificateKeys = parseDirectiveValues(topLevel, 'ssl_certificate_key')
  const clientMaxBodySize = lastValue(parseDirectiveValues(topLevel, 'client_max_body_size'))
  const locations = findNamedBlocks(body, 'location').map((locationBlock, locationIndex) => (
    parseLocationBlock(body, locationBlock, locationIndex)
  ))
  const title = extractLeadingComment(source, block.start) ||
    serverNames[0] ||
    `Server ${index + 1}`
  const line = lineNumberAt(source, block.start)

  return {
    id: `${line}-${index}`,
    title,
    line,
    listens,
    serverNames,
    returns,
    sslCertificates,
    sslCertificateKeys,
    clientMaxBodySize,
    locations,
    flags: {
      https: isHttpsServer(listens, sslCertificates),
      redirect: returns.length > 0,
      proxy: locations.some((location) => location.kind === 'proxy' || location.kind === 'websocket'),
      static: locations.some((location) => location.kind === 'static' || location.kind === 'spa'),
      websocket: locations.some((location) => location.kind === 'websocket'),
    },
  }
}

function parseLocationBlock(serverBody, block, index) {
  const header = block.header.replace(/^location\s+/, '').trim()
  const { matcher, path } = parseLocationHeader(header)
  const body = block.body
  const proxyPass = lastValue(parseDirectiveValues(body, 'proxy_pass'))
  const root = lastValue(parseDirectiveValues(body, 'root'))
  const alias = lastValue(parseDirectiveValues(body, 'alias'))
  const returns = parseDirectiveValues(body, 'return')
  const indexes = parseDirectiveValues(body, 'index')
  const tryFiles = parseDirectiveValues(body, 'try_files')
  const clientMaxBodySize = lastValue(parseDirectiveValues(body, 'client_max_body_size'))
  const proxyHttpVersion = lastValue(parseDirectiveValues(body, 'proxy_http_version'))
  const proxyBuffering = lastValue(parseDirectiveValues(body, 'proxy_buffering'))
  const proxyHeaders = parseProxyHeaders(body)
  const timeouts = parseTimeouts(body)
  const title = extractLeadingComment(serverBody, block.start) || path || `Location ${index + 1}`
  const kind = classifyLocation({
    proxyPass,
    root,
    alias,
    returns,
    tryFiles,
    proxyHeaders,
    proxyHttpVersion,
  })

  return {
    id: `${lineNumberAt(serverBody, block.start)}-${index}`,
    title,
    matcher,
    path,
    kind,
    proxyPass,
    root,
    alias,
    returns,
    indexes,
    tryFiles,
    clientMaxBodySize,
    proxyHeaders,
    proxyHttpVersion,
    proxyBuffering,
    timeouts,
  }
}

function parseProxyHeaders(body) {
  return parseDirectiveValues(body, 'proxy_set_header')
    .map((value) => {
      const [name = '', ...rest] = splitDirectiveArgs(value)
      return {
        name,
        value: rest.join(' '),
      }
    })
    .filter((header) => header.name)
}

function parseTimeouts(body) {
  return ['proxy_connect_timeout', 'proxy_send_timeout', 'proxy_read_timeout']
    .map((name) => ({
      name,
      value: lastValue(parseDirectiveValues(body, name)),
    }))
    .filter((item) => item.value)
}

function buildConfigCounts(servers) {
  return {
    servers: servers.length,
    locations: servers.reduce((sum, server) => sum + server.locations.length, 0),
    https: servers.filter((server) => server.flags.https).length,
    redirects: servers.filter((server) => server.flags.redirect).length,
    proxies: servers.reduce((sum, server) => (
      sum + server.locations.filter((location) => location.kind === 'proxy' || location.kind === 'websocket').length
    ), 0),
    staticSites: servers.reduce((sum, server) => (
      sum + server.locations.filter((location) => location.kind === 'static' || location.kind === 'spa').length
    ), 0),
    websockets: servers.reduce((sum, server) => (
      sum + server.locations.filter((location) => location.kind === 'websocket').length
    ), 0),
  }
}

function classifyLocation(location) {
  if (location.proxyPass) {
    const hasUpgrade = location.proxyHeaders.some((header) => (
      header.name.toLowerCase() === 'upgrade' ||
      String(header.value || '').toLowerCase().includes('upgrade')
    ))

    return hasUpgrade || location.proxyHttpVersion === '1.1' ? 'websocket' : 'proxy'
  }

  if (location.returns.length) {
    return 'redirect'
  }

  if (location.root || location.alias) {
    return location.tryFiles.length ? 'spa' : 'static'
  }

  return 'rule'
}

function parseLocationHeader(header) {
  const parts = splitDirectiveArgs(header)
  const first = parts[0] || ''
  const second = parts[1] || ''
  const modifiers = new Set(['=', '~', '~*', '^~'])

  if (modifiers.has(first)) {
    return {
      matcher: first,
      path: second || '',
    }
  }

  return {
    matcher: '',
    path: first || header,
  }
}

function parseDirectiveValues(source, directive) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(directive)}\\s+([^;]+);`, 'g')
  const values = []
  let match = pattern.exec(source)

  while (match) {
    values.push(match[1].trim())
    match = pattern.exec(source)
  }

  return values
}

function findNamedBlocks(source, name) {
  const blocks = []
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b[^{};]*\\{`, 'g')
  let match = pattern.exec(source)

  while (match) {
    if (isInsideLineComment(source, match.index)) {
      pattern.lastIndex = match.index + name.length
      match = pattern.exec(source)
      continue
    }

    const openIndex = source.indexOf('{', match.index)

    if (isInsideLineComment(source, openIndex)) {
      pattern.lastIndex = openIndex + 1
      match = pattern.exec(source)
      continue
    }

    const closeIndex = findMatchingBrace(source, openIndex)

    if (closeIndex < 0) {
      break
    }

    blocks.push({
      name,
      start: match.index,
      end: closeIndex + 1,
      header: source.slice(match.index, openIndex).trim(),
      body: source.slice(openIndex + 1, closeIndex),
    })

    pattern.lastIndex = closeIndex + 1
    match = pattern.exec(source)
  }

  return blocks
}

function findMatchingBrace(source, openIndex) {
  let depth = 0
  let quote = ''
  let inComment = false

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    const previous = source[index - 1]

    if (inComment) {
      if (char === '\n') {
        inComment = false
      }
      continue
    }

    if (!quote && char === '#') {
      inComment = true
      continue
    }

    if ((char === '"' || char === "'") && previous !== '\\') {
      quote = quote === char ? '' : (quote || char)
      continue
    }

    if (quote) {
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function maskNestedBlocks(source) {
  let depth = 0
  let quote = ''
  let inComment = false
  let masked = ''

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const previous = source[index - 1]

    if (inComment) {
      if (char === '\n') {
        inComment = false
        masked += char
      } else {
        masked += depth > 0 ? ' ' : char
      }
      continue
    }

    if (!quote && char === '#') {
      inComment = true
      masked += depth > 0 ? ' ' : char
      continue
    }

    if ((char === '"' || char === "'") && previous !== '\\') {
      quote = quote === char ? '' : (quote || char)
    }

    if (!quote && char === '{') {
      depth += 1
      masked += ' '
      continue
    }

    if (!quote && char === '}') {
      depth = Math.max(0, depth - 1)
      masked += ' '
      continue
    }

    masked += depth > 0 ? (char === '\n' ? '\n' : ' ') : char
  }

  return masked
}

function extractLeadingComment(source, blockStart) {
  const before = source.slice(0, blockStart).split('\n')
  const comments = []

  for (let index = before.length - 1; index >= 0; index -= 1) {
    const line = before[index].trim()

    if (!line) {
      if (comments.length) {
        break
      }
      continue
    }

    if (!line.startsWith('#')) {
      break
    }

    const cleaned = line.replace(SECTION_COMMENT_RE, '').trim()

    if (cleaned) {
      comments.unshift(cleaned)
    }
  }

  return comments[comments.length - 1] || ''
}

function isHttpsServer(listens, sslCertificates) {
  return sslCertificates.length > 0 ||
    listens.some((listen) => /\b443\b/.test(listen) || /\bssl\b/i.test(listen))
}

function isInsideLineComment(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1
  const before = source.slice(lineStart, index)

  return before.trimStart().startsWith('#')
}

function splitDirectiveArgs(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function lastValue(values) {
  return values.length ? values[values.length - 1] : ''
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n/g, '\n')
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
