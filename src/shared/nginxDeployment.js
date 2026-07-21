export const DEFAULT_DOCKER_NETWORK = 'proxy'
export const DEFAULT_NGINX_CONTAINER_NAME = 'nginx'

const DOCKER_RESOURCE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const LEGACY_NETWORK_ARG_RE = /(?:^|\s)--(?:network|net)(?:\s*=\s*|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/g

export function resolveDockerNetworkConfig(input = {}) {
  const explicitNetworkName = String(input.networkName || '').trim()
  const extraArgs = String(input.extraArgs || '').trim()
  const matches = [...extraArgs.matchAll(LEGACY_NETWORK_ARG_RE)]

  if (matches.length > 1) {
    throw new Error('额外参数中存在多个 Docker 网络参数，请只使用“Docker 网络”字段')
  }

  if (explicitNetworkName && matches.length) {
    throw new Error('Docker 网络已经有独立字段，请从额外参数中删除 --network/--net')
  }

  const legacyNetworkName = matches[0]
    ? String(matches[0][1] || matches[0][2] || matches[0][3] || '').trim()
    : ''
  const networkName = explicitNetworkName || legacyNetworkName || DEFAULT_DOCKER_NETWORK
  const cleanedExtraArgs = matches.length
    ? `${extraArgs.slice(0, matches[0].index)} ${extraArgs.slice(matches[0].index + matches[0][0].length)}`
        .replace(/\s+/g, ' ')
        .trim()
    : extraArgs

  validateDockerResourceName(networkName, 'Docker 网络')

  return {
    networkName,
    extraArgs: cleanedExtraArgs,
    migratedLegacyNetwork: Boolean(legacyNetworkName),
  }
}

export function normalizeNginxContainerName(value) {
  const containerName = String(value || DEFAULT_NGINX_CONTAINER_NAME).trim() || DEFAULT_NGINX_CONTAINER_NAME
  validateDockerResourceName(containerName, 'Nginx 容器名')
  return containerName
}

export function buildNginxProxyTarget(containerName, containerPort) {
  const normalizedName = String(containerName || '').trim()
  const normalizedPort = Number(containerPort || 0)

  if (!normalizedName || !Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    return ''
  }

  return `http://${normalizedName}:${normalizedPort}/`
}

export function buildDockerNginxTestCommand(containerName = DEFAULT_NGINX_CONTAINER_NAME) {
  return `docker exec ${shellQuote(normalizeNginxContainerName(containerName))} nginx -t`
}

export function buildDockerNginxReloadCommand(containerName = DEFAULT_NGINX_CONTAINER_NAME) {
  return `docker exec ${shellQuote(normalizeNginxContainerName(containerName))} nginx -s reload`
}

export function buildDockerNginxPublishCommand(containerName = DEFAULT_NGINX_CONTAINER_NAME) {
  return `${buildDockerNginxTestCommand(containerName)} && ${buildDockerNginxReloadCommand(containerName)}`
}

export function analyzeNginxProxyConfig(content = '', options = {}) {
  const containerName = String(options.containerName || '').trim()
  const containerPort = Number(options.containerPort || 0)
  const expected = buildNginxProxyTarget(containerName, containerPort)
  const source = stripNginxComments(String(content || '').replace(/\r\n/g, '\n'))
  const upstreams = parseUpstreams(source)
  const proxyPasses = parseDirectiveValues(source, 'proxy_pass')
  const references = []
  const unverifiable = []

  for (const proxyPass of proxyPasses) {
    const direct = parseProxyUrl(proxyPass)

    if (!direct) {
      if (proxyPass.includes(containerName) || proxyPass.includes('$')) {
        unverifiable.push(proxyPass)
      }
      continue
    }

    if (sameDockerName(direct.host, containerName)) {
      references.push({
        type: 'direct',
        proxyPass,
        host: direct.host,
        port: direct.port,
        expectedPort: containerPort,
        matches: direct.port === containerPort,
      })
      continue
    }

    const upstream = upstreams.get(direct.host.toLowerCase())

    if (!upstream) {
      continue
    }

    for (const server of upstream.servers) {
      if (!sameDockerName(server.host, containerName)) {
        continue
      }

      references.push({
        type: 'upstream',
        upstream: upstream.name,
        proxyPass,
        server: server.raw,
        host: server.host,
        port: server.port,
        expectedPort: containerPort,
        matches: server.port === containerPort,
      })
    }
  }

  const mismatches = references.filter((item) => !item.matches)
  const matches = references.filter((item) => item.matches)
  const status = mismatches.length
    ? 'mismatch'
    : matches.length
      ? 'matched'
      : unverifiable.length
        ? 'unverifiable'
        : 'missing'

  return {
    status,
    expected,
    references,
    matches,
    mismatches,
    unverifiable,
  }
}

function parseUpstreams(source) {
  const upstreams = new Map()
  const pattern = /\bupstream\s+([^\s{]+)\s*\{([^{}]*)\}/g
  let match = pattern.exec(source)

  while (match) {
    const name = match[1].trim()
    const servers = parseDirectiveValues(match[2], 'server')
      .map(parseUpstreamServer)
      .filter(Boolean)

    upstreams.set(name.toLowerCase(), { name, servers })
    match = pattern.exec(source)
  }

  return upstreams
}

function parseProxyUrl(value) {
  const text = String(value || '').trim()

  if (!/^https?:\/\//i.test(text) || text.includes('$')) {
    return null
  }

  try {
    const url = new URL(text)
    return {
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    }
  } catch {
    return null
  }
}

function parseUpstreamServer(value) {
  const raw = String(value || '').trim().split(/\s+/)[0] || ''

  if (!raw || raw.startsWith('unix:') || raw.includes('$')) {
    return null
  }

  const ipv6 = raw.match(/^\[([^\]]+)](?::(\d+))?$/)

  if (ipv6) {
    return { raw, host: ipv6[1], port: Number(ipv6[2] || 80) }
  }

  const separator = raw.lastIndexOf(':')
  const hasPort = separator > 0 && /^\d+$/.test(raw.slice(separator + 1))

  return {
    raw,
    host: hasPort ? raw.slice(0, separator) : raw,
    port: hasPort ? Number(raw.slice(separator + 1)) : 80,
  }
}

function parseDirectiveValues(source, directive) {
  const pattern = new RegExp(`(?:^|[;{}\\n])\\s*${directive}\\s+([^;]+);`, 'g')
  const values = []
  let match = pattern.exec(source)

  while (match) {
    values.push(match[1].trim())
    match = pattern.exec(source)
  }

  return values
}

function stripNginxComments(source) {
  return source
    .split('\n')
    .map((line) => {
      let quote = ''

      for (let index = 0; index < line.length; index += 1) {
        const character = line[index]

        if ((character === '"' || character === "'") && line[index - 1] !== '\\') {
          quote = quote === character ? '' : (quote || character)
        }

        if (character === '#' && !quote) {
          return line.slice(0, index)
        }
      }

      return line
    })
    .join('\n')
}

function sameDockerName(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase()
}

function validateDockerResourceName(value, label) {
  if (!DOCKER_RESOURCE_NAME_RE.test(String(value || ''))) {
    throw new Error(`${label}只能包含字母、数字、点、下划线和连字符，并且必须以字母或数字开头`)
  }
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`
}
