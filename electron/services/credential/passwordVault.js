import electron from 'electron'

const { safeStorage } = electron

/**
 * 使用 Electron safeStorage 加密用户选择记住的密码。
 * 返回值是 base64 字符串，适合写入 SQLite 的 password_secret 字段。
 */
export function encryptPassword(password) {
  const text = String(password || '')

  if (!text) {
    return ''
  }

  ensureSafeStorage()

  return safeStorage.encryptString(text).toString('base64')
}

/**
 * 解密数据库中的 password_secret。
 * 只在需要回填密码表单时调用，不把密文暴露给 Vue 页面。
 */
export function decryptPassword(secret) {
  const encoded = String(secret || '')

  if (!encoded) {
    return ''
  }

  ensureSafeStorage()

  return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
}

/**
 * 确认当前系统可用安全加密能力。
 * Windows 下通常会使用系统凭据/用户会话相关能力保护密文。
 */
function ensureSafeStorage() {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error('当前系统不可用安全加密存储，无法记住密码')
  }
}
