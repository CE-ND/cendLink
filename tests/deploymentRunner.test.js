import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildDockerRunCommand,
  previewDeployment,
} from '../electron/services/deployment/deploymentRunner.js'

test('docker run maps the host port and joins the requested network', () => {
  const command = buildDockerRunCommand({
    containerName: 'aibox-service',
    hostPort: 8060,
    containerPort: 8086,
    envVars: [{ key: 'TZ', value: 'Asia/Shanghai' }],
    mounts: [{ hostPath: '/data/aibox/logs', containerPath: '/app/logs' }],
    restartPolicy: 'unless-stopped',
    networkName: 'proxy',
    extraArgs: '--cpus 2',
    imageRef: 'aibox-service:1.0.1',
  })

  assert.match(command, /-p 8060:8086/)
  assert.match(command, /--network 'proxy'/)
  assert.match(command, /--cpus 2/)
  assert.equal((command.match(/--network/g) || []).length, 1)
})

test('deployment preview keeps host mapping separate from the Nginx proxy target', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cendlink-deploy-test-'))
  const packagePath = path.join(tempDir, 'aibox-service.tar.gz')

  try {
    await fs.writeFile(packagePath, 'fixture')
    const preview = await previewDeployment({
      localPackagePath: packagePath,
      serviceName: 'aibox-service',
      serviceVersion: '1.0.1',
      imageName: 'aibox-service',
      imageTag: '1.0.1',
      containerName: 'aibox-service',
      hostPort: 8060,
      containerPort: 8086,
      networkName: 'proxy',
      nginxContainerName: 'nginx',
    })

    assert.match(preview.runCommand, /-p 8060:8086/)
    assert.match(preview.runCommand, /--network 'proxy'/)
    assert.equal(preview.nginxProxyTarget, 'http://aibox-service:8086/')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('deployment preview can disable Nginx diagnostics without disabling Docker networking', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cendlink-no-nginx-test-'))
  const packagePath = path.join(tempDir, 'standalone-service.tar.gz')

  try {
    await fs.writeFile(packagePath, 'fixture')
    const preview = await previewDeployment({
      localPackagePath: packagePath,
      serviceName: 'standalone-service',
      serviceVersion: '1.0.0',
      imageName: 'standalone-service',
      imageTag: '1.0.0',
      containerName: 'standalone-service',
      hostPort: 8060,
      containerPort: 8086,
      networkName: 'bridge',
      nginxProxyCheckEnabled: false,
      nginxContainerName: '',
    })

    assert.match(preview.runCommand, /--network 'bridge'/)
    assert.equal(preview.nginxProxyCheckEnabled, false)
    assert.equal(preview.nginxContainerName, '')
    assert.equal(preview.nginxProxyTarget, '')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
