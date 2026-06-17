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

export function diffConfigs(oldContent, newContent) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const changes = []
  const maxLen = Math.max(oldLines.length, newLines.length)

  let i = 0

  while (i < maxLen) {
    if (oldLines[i] !== newLines[i]) {
      let removeEnd = i
      let addEnd = i

      while (removeEnd < oldLines.length && addEnd < newLines.length && oldLines[removeEnd] !== newLines[addEnd]) {
        removeEnd++
        addEnd++
      }

      while (removeEnd < oldLines.length && (addEnd >= newLines.length || oldLines[removeEnd] !== newLines[addEnd])) {
        removeEnd++
      }

      while (addEnd < newLines.length && (removeEnd >= oldLines.length || oldLines[removeEnd] !== newLines[addEnd])) {
        addEnd++
      }

      changes.push({
        type: 'change',
        oldStart: i + 1,
        oldLines: oldLines.slice(i, removeEnd),
        newStart: i + 1,
        newLines: newLines.slice(i, addEnd),
      })

      i = Math.max(removeEnd, addEnd)
    } else {
      i++
    }
  }

  return {
    same: changes.length === 0,
    changes,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
  }
}
