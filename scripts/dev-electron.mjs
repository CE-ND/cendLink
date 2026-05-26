import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const devServerUrl = 'http://127.0.0.1:4001'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const electronCli = path.join(rootDir, 'node_modules', 'electron', 'cli.js')

let vite = null
if (await hasMatchingDevServer(devServerUrl)) {
  console.log(`[dev-electron] Reusing existing dev server at ${devServerUrl}`)
} else {
  vite = spawn(process.execPath, [viteCli], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  })

  await waitForServer(devServerUrl)
}

const electron = spawn(process.execPath, [electronCli, '.'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
  },
})

function shutdown(code = 0) {
  vite?.kill()
  electron.kill()
  process.exit(code)
}

electron.on('exit', (code) => {
  shutdown(code ?? 0)
})

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

function waitForServer(url) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()

    const check = () => {
      http
        .get(url, (response) => {
          response.resume()
          resolve()
        })
        .on('error', () => {
          if (Date.now() - startedAt > 30000) {
            reject(new Error(`Vite dev server did not start: ${url}`))
            return
          }

          setTimeout(check, 300)
        })
    }

    check()
  })
}

async function hasMatchingDevServer(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' })

    if (!response.ok) {
      return false
    }

    const html = await response.text()
    return html.toLowerCase().includes('<title>cendlink</title>')
  } catch {
    return false
  }
}
