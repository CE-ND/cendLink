import assert from 'node:assert/strict'
import test from 'node:test'
import { previewFrontendUpload } from '../electron/services/frontend/frontendUploadRunner.js'

const baseConfig = {
  projectName: 'console-web',
  projectDir: 'console-web',
  remoteBaseDir: '/data/apps/frontend/html',
  remoteTargetDir: '/data/apps/frontend/html/console-web',
  remoteUploadDir: '/data/cendlink/frontend-packages',
  restartNginx: true,
}

test('frontend preview expands auto Nginx mode into the adaptive command', async () => {
  const preview = await previewFrontendUpload({
    ...baseConfig,
    nginxRestartCommand: 'auto',
  })

  assert.equal(preview.nginxRestartCommandSetting, 'auto')
  assert.match(preview.restartCommand, /docker inspect/)
  assert.match(preview.restartCommand, /systemctl cat nginx\.service/)
})

test('frontend preview migrates the legacy systemd default to auto mode', async () => {
  const preview = await previewFrontendUpload({
    ...baseConfig,
    nginxRestartCommand: 'systemctl restart nginx',
  })

  assert.equal(preview.nginxRestartCommandSetting, 'auto')
  assert.match(preview.restartCommand, /docker exec 'nginx' nginx -t/)
})

test('frontend preview preserves a custom Nginx command', async () => {
  const preview = await previewFrontendUpload({
    ...baseConfig,
    nginxRestartCommand: 'sudo service nginx reload',
  })

  assert.equal(preview.nginxRestartCommandSetting, 'sudo service nginx reload')
  assert.equal(preview.restartCommand, 'sudo service nginx reload')
})
