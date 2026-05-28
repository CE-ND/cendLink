const DEFAULT_JAVA_VERSION = '17'
const DEFAULT_STANDARD_JAVA_OPTS = '-Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=200'
const DEFAULT_JAMMY_JAVACP_JAVA_OPTS =
  '-Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -Djava.io.tmpdir=/tmp -Dorg.bytedeco.javacpp.cachedir=/tmp/javacpp-cache'

export const DEFAULT_DOCKERFILE_TEMPLATE_ID = 'standard-alpine'

export const BUILTIN_DOCKERFILE_TEMPLATES = [
  {
    id: 'standard-alpine',
    name: '通用 Alpine',
    description: '适合普通 Spring Boot Jar，体积更小，默认使用非 root 用户。',
    family: 'alpine',
    sourceType: 'builtin',
    defaultConfig: {
      javaVersion: DEFAULT_JAVA_VERSION,
      baseImageFamily: 'alpine',
      useNonRootUser: true,
      appUser: 'spring',
      javaOpts: DEFAULT_STANDARD_JAVA_OPTS,
    },
    render: renderStandardTemplate('alpine'),
  },
  {
    id: 'standard-jammy',
    name: '通用 Jammy',
    description: '适合需要 glibc 环境的项目，保留常规运行参数和非 root 用户。',
    family: 'jammy',
    sourceType: 'builtin',
    defaultConfig: {
      javaVersion: DEFAULT_JAVA_VERSION,
      baseImageFamily: 'jammy',
      useNonRootUser: true,
      appUser: 'spring',
      javaOpts: DEFAULT_STANDARD_JAVA_OPTS,
    },
    render: renderStandardTemplate('jammy'),
  },
  {
    id: 'jammy-javacpp',
    name: 'Jammy JavaCPP',
    description: '适合 JavaCPP、OpenCV、FFmpeg 等原生依赖项目，内置缓存目录。',
    family: 'jammy',
    sourceType: 'builtin',
    defaultConfig: {
      javaVersion: DEFAULT_JAVA_VERSION,
      baseImageFamily: 'jammy',
      useNonRootUser: true,
      appUser: 'spring',
      javaOpts: DEFAULT_JAMMY_JAVACP_JAVA_OPTS,
    },
    render: renderJavaCppTemplate,
  },
]

export function getDockerfileTemplateById(templateId) {
  return BUILTIN_DOCKERFILE_TEMPLATES.find((item) => item.id === templateId) || null
}

export function getDockerfileTemplateDefaults(templateId = DEFAULT_DOCKERFILE_TEMPLATE_ID) {
  const template = getDockerfileTemplateById(templateId) || BUILTIN_DOCKERFILE_TEMPLATES[0]

  return {
    templateId: template.id,
    templateName: template.name,
    templateDescription: template.description,
    sourceType: template.sourceType,
    javaVersion: template.defaultConfig.javaVersion || DEFAULT_JAVA_VERSION,
    baseImageFamily: template.defaultConfig.baseImageFamily || 'alpine',
    baseImage: buildBaseImage(template.defaultConfig.baseImageFamily || 'alpine', DEFAULT_JAVA_VERSION),
    useNonRootUser: Boolean(template.defaultConfig.useNonRootUser),
    appUser: template.defaultConfig.appUser || 'spring',
    javaOpts: template.defaultConfig.javaOpts || DEFAULT_STANDARD_JAVA_OPTS,
  }
}

export function buildBaseImage(family, javaVersion = DEFAULT_JAVA_VERSION) {
  const normalizedFamily = String(family || 'alpine').trim() === 'jammy' ? 'jammy' : 'alpine'
  const version = normalizeJavaVersion(javaVersion)

  return `eclipse-temurin:${version}-jre-${normalizedFamily}`
}

export function resolveDockerfileTemplate(templateId, templateText = '') {
  const builtinTemplate = getDockerfileTemplateById(templateId)

  if (builtinTemplate) {
    return builtinTemplate
  }

  const rawText = String(templateText || '').trim()

  if (!rawText) {
    return getDockerfileTemplateById(DEFAULT_DOCKERFILE_TEMPLATE_ID)
  }

  return {
    id: String(templateId || 'custom-template'),
    name: '自定义 Dockerfile',
    description: '用户导入或保存的 Dockerfile 模板。',
    family: 'custom',
    sourceType: 'custom',
    defaultConfig: {
      javaVersion: DEFAULT_JAVA_VERSION,
      baseImageFamily: 'custom',
      useNonRootUser: true,
      appUser: 'spring',
      javaOpts: DEFAULT_STANDARD_JAVA_OPTS,
    },
    render: (config) => renderRawDockerfileTemplate(rawText, config),
  }
}

export function renderDockerfileTemplate(templateOrText, config = {}) {
  if (!templateOrText) {
    return ''
  }

  if (typeof templateOrText === 'string') {
    return renderRawDockerfileTemplate(templateOrText, config)
  }

  if (typeof templateOrText.render === 'function') {
    return templateOrText.render(normalizeTemplateConfig(config))
  }

  if (templateOrText.templateText) {
    return renderRawDockerfileTemplate(templateOrText.templateText, config)
  }

  return ''
}

export function normalizeTemplateConfig(input = {}) {
  const templateId = String(input.dockerfileTemplateId || DEFAULT_DOCKERFILE_TEMPLATE_ID)
  const template = getDockerfileTemplateById(templateId)
  const family = normalizeBaseImageFamily(
    input.baseImageFamily || template?.defaultConfig?.baseImageFamily || 'alpine',
  )
  const javaVersion = normalizeJavaVersion(
    input.javaVersion || template?.defaultConfig?.javaVersion || DEFAULT_JAVA_VERSION,
  )
  const useNonRootUser =
    input.useNonRootUser !== undefined
      ? Boolean(input.useNonRootUser)
      : Boolean(template?.defaultConfig?.useNonRootUser)
  const appUser = normalizeUserName(input.appUser || template?.defaultConfig?.appUser || 'spring')
  const javaOpts = String(
    input.javaOpts || template?.defaultConfig?.javaOpts || DEFAULT_STANDARD_JAVA_OPTS,
  ).trim()

  return {
    jarPath: String(input.jarPath || '').trim(),
    serviceName: String(input.serviceName || '').trim(),
    serviceVersion: String(input.serviceVersion || '').trim(),
    servicePort: Number(input.servicePort || 0),
    javaVersion,
    baseImageFamily: family,
    baseImage: String(input.baseImage || '').trim() || buildBaseImage(family, javaVersion),
    useNonRootUser,
    appUser,
    javaOpts: javaOpts || DEFAULT_STANDARD_JAVA_OPTS,
    dockerfileTemplateId: templateId,
    dockerfileTemplateName: String(input.dockerfileTemplateName || template?.name || '自定义 Dockerfile'),
    dockerfileTemplateDescription: String(
      input.dockerfileTemplateDescription || template?.description || '',
    ),
    dockerfileSourceType: String(input.dockerfileSourceType || template?.sourceType || 'custom'),
    dockerfileTemplateText: String(input.dockerfileTemplateText || '').trim(),
  }
}

export function parseDockerfileText(dockerfileText = '') {
  const normalizedText = String(dockerfileText || '')
  const lines = normalizedText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  const fromLine = lines.find((line) => /^FROM\s+/i.test(line)) || ''
  const baseImage = extractDirectiveValue(fromLine, /^FROM\s+/i)
  const baseImageFamily = detectBaseImageFamily(baseImage)
  const javaVersion = extractJavaVersion(baseImage) || DEFAULT_JAVA_VERSION
  const servicePort =
    extractEnvValue(lines, 'SERVER_PORT') || extractExposePort(lines) || 8080
  const javaOpts = extractEnvValue(lines, 'JAVA_OPTS') || DEFAULT_STANDARD_JAVA_OPTS
  const appUser = extractAppUser(lines) || 'spring'
  const useNonRootUser = hasNonRootUserSignals(lines)
  const entrypoint = lines.find((line) => /^ENTRYPOINT\s+/i.test(line)) || ''
  const workdir = lines.find((line) => /^WORKDIR\s+/i.test(line)) || ''
  const templateId = inferTemplateId({
    baseImage,
    baseImageFamily,
    javaOpts,
    useNonRootUser,
    entrypoint,
  })
  const template = getDockerfileTemplateById(templateId)

  return {
    templateId,
    templateName: template?.name || '自定义 Dockerfile',
    templateDescription: template?.description || '用户导入的 Dockerfile',
    sourceType: template ? 'builtin' : 'custom',
    baseImage,
    baseImageFamily,
    javaVersion,
    servicePort,
    javaOpts,
    appUser,
    useNonRootUser,
    entrypoint,
    workdir,
    confidence: template ? 'high' : 'medium',
    rawText: normalizedText,
  }
}

export function createDockerfileTemplateText(dockerfileText = '', parsedInput = null) {
  const originalText = String(dockerfileText || '').trim()

  if (!originalText) {
    return ''
  }

  const parsed = parsedInput || parseDockerfileText(originalText)
  let templateText = originalText

  if (parsed.baseImage) {
    templateText = templateText.replace(
      new RegExp(`^(\\s*FROM\\s+)${escapeRegExp(parsed.baseImage)}(\\s*)$`, 'im'),
      '$1{{baseImage}}$2',
    )
  }

  templateText = templateText.replace(
    /^(\s*ENV\s+SERVER_PORT=)(?:"[^"]*"|'[^']*'|[^\s]+)(\s*)$/im,
    '$1{{servicePort}}$2',
  )

  templateText = templateText.replace(
    /^(\s*ENV\s+SERVER_PORT\s+)(?:"[^"]*"|'[^']*'|[^\s]+)(\s*)$/im,
    '$1{{servicePort}}$2',
  )

  templateText = templateText.replace(
    /^(\s*EXPOSE\s+)[0-9]{1,5}(\s*)$/im,
    '$1{{servicePort}}$2',
  )

  templateText = templateText.replace(/(--server\.port=)[0-9]{1,5}/g, '$1{{servicePort}}')

  if (parsed.javaOpts) {
    templateText = templateText.replace(
      /^(\s*ENV\s+JAVA_OPTS=)(?:"[^"]*"|'[^']*'|.*)(\s*)$/im,
      '$1"{{javaOpts}}"$2',
    )

    templateText = templateText.replace(
      /^(\s*ENV\s+JAVA_OPTS\s+)(?:"[^"]*"|'[^']*'|.*)(\s*)$/im,
      '$1"{{javaOpts}}"$2',
    )
  }

  templateText = templateText.replace(
    /^(\s*(?:COPY|ADD)(?:\s+--chown=[^\s]+)?\s+)(?!app\.jar\b)[^\s]+\.jar(\s+app\.jar\b.*)$/gim,
    '$1app.jar$2',
  )

  if (parsed.useNonRootUser && parsed.appUser) {
    templateText = replaceDockerUserReferences(templateText, parsed.appUser)
  }

  return templateText
}

function replaceDockerUserReferences(templateText, userName) {
  const escapedUser = escapeRegExp(userName)

  return String(templateText || '')
    .replace(new RegExp(`(\\bUSER\\s+)${escapedUser}(\\b)`, 'g'), '$1{{appUser}}$2')
    .replace(new RegExp(`(--chown=)${escapedUser}:${escapedUser}`, 'g'), '$1{{appUser}}:{{appUser}}')
    .replace(new RegExp(`(\\bchown\\b[^\\n]*?)${escapedUser}:${escapedUser}`, 'g'), '$1{{appUser}}:{{appUser}}')
    .replace(
      new RegExp(`(\\b(?:groupadd|addgroup)\\b(?:\\s+[^\\s\\\\]+)*\\s+)${escapedUser}(?=\\s|\\\\|$)`, 'g'),
      '$1{{appUser}}',
    )
    .replace(
      new RegExp(`(\\b(?:useradd|adduser)\\b[^\\n]*\\s)${escapedUser}(?=\\s|\\\\|$)`, 'g'),
      '$1{{appUser}}',
    )
    .replace(new RegExp(`(-G\\s+)${escapedUser}(?=\\s|\\\\|$)`, 'g'), '$1{{appUser}}')
    .replace(new RegExp(`(--gid\\s+)${escapedUser}(?=\\s|\\\\|$)`, 'g'), '$1{{appUser}}')
}

function renderStandardTemplate(family) {
  return (config) => {
    const normalized = normalizeTemplateConfig({
      ...config,
      baseImageFamily: family,
    })
    const createUserCommand =
      family === 'jammy'
        ? `groupadd --system ${normalized.appUser} && useradd --system --gid ${normalized.appUser} --home-dir /app --shell /usr/sbin/nologin ${normalized.appUser}`
        : `addgroup -S ${normalized.appUser} && adduser -S ${normalized.appUser} -G ${normalized.appUser}`
    const userBlock = normalized.useNonRootUser
      ? `RUN ${createUserCommand} && mkdir -p /app && chown -R ${normalized.appUser}:${normalized.appUser} /app\n\nWORKDIR /app\n\nCOPY --chown=${normalized.appUser}:${normalized.appUser} app.jar app.jar\n\nUSER ${normalized.appUser}`
      : `WORKDIR /app\n\nCOPY app.jar app.jar`

    return `FROM ${normalized.baseImage}

${userBlock}

ENV SERVER_PORT=${normalized.servicePort}
ENV JAVA_OPTS="${escapeDockerEnv(normalized.javaOpts)}"

EXPOSE ${normalized.servicePort}

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar --server.port=$SERVER_PORT"]
`
  }
}

function renderJavaCppTemplate(config) {
  const normalized = normalizeTemplateConfig({
    ...config,
    baseImageFamily: 'jammy',
  })
  const userBlock = normalized.useNonRootUser
    ? `RUN groupadd --system ${normalized.appUser} \
    && useradd --system --gid ${normalized.appUser} --home-dir /app --shell /usr/sbin/nologin ${normalized.appUser} \
    && mkdir -p /app /tmp/javacpp-cache \
    && chown -R ${normalized.appUser}:${normalized.appUser} /app /tmp/javacpp-cache \
    && chmod 1777 /tmp /tmp/javacpp-cache`
    : `RUN mkdir -p /app /tmp/javacpp-cache \
    && chmod 1777 /tmp /tmp/javacpp-cache`

  const copyBlock = normalized.useNonRootUser
    ? `COPY --chown=${normalized.appUser}:${normalized.appUser} app.jar app.jar`
    : 'COPY app.jar app.jar'

  const userLine = normalized.useNonRootUser ? `\n\nUSER ${normalized.appUser}` : ''

  return `FROM ${normalized.baseImage}

${userBlock}

WORKDIR /app

${copyBlock}${userLine}

ENV SERVER_PORT=${normalized.servicePort}
ENV JAVA_OPTS="${escapeDockerEnv(normalized.javaOpts)}"

EXPOSE ${normalized.servicePort}

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar --server.port=$SERVER_PORT"]
`
}

function renderRawDockerfileTemplate(templateText, config = {}) {
  const normalized = normalizeTemplateConfig(config)
  const replacements = {
    baseImage: normalized.baseImage,
    baseImageFamily: normalized.baseImageFamily,
    appUser: normalized.appUser,
    javaVersion: normalized.javaVersion,
    javaOpts: escapeDockerEnv(normalized.javaOpts),
    serviceName: normalized.serviceName,
    serviceVersion: normalized.serviceVersion,
    servicePort: String(normalized.servicePort || 0),
    imageName: String(config.imageName || normalized.serviceName || ''),
    imageTag: String(config.imageTag || normalized.serviceVersion || ''),
    dockerfileTemplateId: normalized.dockerfileTemplateId,
    dockerfileTemplateName: normalized.dockerfileTemplateName,
  }

  return String(templateText || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : _match
  })
}

function extractDirectiveValue(line, pattern) {
  const value = String(line || '').replace(pattern, '').trim()

  return value
}

function extractEnvValue(lines, key) {
  const envPattern = new RegExp(`^ENV\\s+${escapeRegExp(key)}=(?:"([^"]*)"|'([^']*)'|(.*))$`, 'i')
  const envSpacePattern = new RegExp(
    `^ENV\\s+${escapeRegExp(key)}\\s+(?:"([^"]*)"|'([^']*)'|(.*))$`,
    'i',
  )

  for (const line of lines) {
    const match = line.match(envPattern) || line.match(envSpacePattern)

    if (match) {
      return String(match[1] || match[2] || match[3] || '').trim()
    }
  }

  return ''
}

function extractExposePort(lines) {
  for (const line of lines) {
    const match = line.match(/^EXPOSE\s+([0-9]{1,5})/i)

    if (match) {
      return Number(match[1])
    }
  }

  return 0
}

function extractAppUser(lines) {
  for (const line of lines) {
    const userLine = line.match(/^USER\s+([a-zA-Z0-9._-]+)/i)

    if (userLine) {
      return normalizeUserName(userLine[1])
    }

    const addUserLine = line.match(/(?:addgroup|useradd|adduser)[^]*?\s([a-zA-Z0-9._-]+)\s*$/i)

    if (addUserLine) {
      return normalizeUserName(addUserLine[1])
    }
  }

  return ''
}

function hasNonRootUserSignals(lines) {
  return lines.some((line) => {
    return (
      /^USER\s+(?!root\b)/i.test(line) ||
      /addgroup|groupadd|useradd|adduser/i.test(line) ||
      /COPY\s+--chown=/i.test(line)
    )
  })
}

function detectBaseImageFamily(baseImage) {
  const value = String(baseImage || '').toLowerCase()

  if (value.includes('jammy')) {
    return 'jammy'
  }

  if (value.includes('alpine')) {
    return 'alpine'
  }

  return 'custom'
}

function extractJavaVersion(baseImage) {
  const match = String(baseImage || '').match(/(?:temurin|openjdk)[^:]*:(\d{1,2})/i)

  return match ? normalizeJavaVersion(match[1]) : ''
}

function inferTemplateId({ baseImageFamily, javaOpts, useNonRootUser, entrypoint }) {
  if (baseImageFamily === 'jammy' && /javacpp-cache/i.test(javaOpts + ' ' + entrypoint)) {
    return 'jammy-javacpp'
  }

  if (baseImageFamily === 'jammy') {
    return 'standard-jammy'
  }

  if (baseImageFamily === 'alpine') {
    return 'standard-alpine'
  }

  return useNonRootUser ? 'standard-alpine' : DEFAULT_DOCKERFILE_TEMPLATE_ID
}

function normalizeBaseImageFamily(value) {
  const family = String(value || '').trim().toLowerCase()

  if (family === 'jammy' || family === 'alpine') {
    return family
  }

  return 'custom'
}

function normalizeJavaVersion(value) {
  const version = String(value || DEFAULT_JAVA_VERSION)
    .trim()
    .replace(/^java\s*/i, '')

  return /^[0-9][0-9._-]*$/.test(version) ? version : DEFAULT_JAVA_VERSION
}

function normalizeUserName(value) {
  const userName = String(value || 'spring')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return userName || 'spring'
}

function escapeDockerEnv(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
