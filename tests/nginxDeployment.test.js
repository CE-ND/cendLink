import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_NGINX_PUBLISH_COMMAND,
  analyzeNginxProxyConfig,
  buildAdaptiveNginxPublishCommand,
  buildDockerNginxPublishCommand,
  buildNginxProxyTarget,
  normalizeNginxPublishCommandSetting,
  parseNginxRuntime,
  resolveDockerNetworkConfig,
  resolveNginxPublishCommand,
} from '../src/shared/nginxDeployment.js'

test('legacy Docker network arguments migrate into the structured field', () => {
  assert.deepEqual(
    resolveDockerNetworkConfig({ extraArgs: '--cpus 2 --network proxy --memory 1g' }),
    {
      networkName: 'proxy',
      extraArgs: '--cpus 2 --memory 1g',
      migratedLegacyNetwork: true,
    },
  )
})

test('structured and legacy network arguments cannot be combined', () => {
  assert.throws(
    () => resolveDockerNetworkConfig({ networkName: 'proxy', extraArgs: '--network host' }),
    /独立字段/,
  )
})

test('proxy preview uses the container port instead of the host port', () => {
  assert.equal(buildNginxProxyTarget('aibox-service', 8086), 'http://aibox-service:8086/')
})

test('Docker Nginx publish command validates before reloading', () => {
  assert.equal(
    buildDockerNginxPublishCommand('nginx'),
    "docker exec 'nginx' nginx -t && docker exec 'nginx' nginx -s reload",
  )
})

test('adaptive Nginx publish command prefers Docker and falls back to systemd', () => {
  const command = buildAdaptiveNginxPublishCommand('nginx')

  assert.match(command, /docker inspect/)
  assert.match(command, /docker exec 'nginx' nginx -t/)
  assert.match(command, /systemctl cat nginx\.service/)
  assert.match(command, /systemctl reload nginx \|\| systemctl restart nginx/)
  assert.match(command, /__CENDLINK_NGINX_RUNTIME__=docker'; docker exec/)
  assert.match(command, /systemctl restart nginx; else/)
  assert.match(command, /exit 21; fi$/)
  assert.ok(command.indexOf('docker inspect') < command.indexOf('systemctl cat'))
})

test('legacy built-in Nginx commands migrate to auto while custom commands remain unchanged', () => {
  assert.equal(normalizeNginxPublishCommandSetting('systemctl restart nginx'), AUTO_NGINX_PUBLISH_COMMAND)
  assert.equal(
    normalizeNginxPublishCommandSetting("docker exec 'nginx' nginx -t && docker exec 'nginx' nginx -s reload"),
    AUTO_NGINX_PUBLISH_COMMAND,
  )
  assert.equal(normalizeNginxPublishCommandSetting('sudo service nginx reload'), 'sudo service nginx reload')
  assert.match(resolveNginxPublishCommand(AUTO_NGINX_PUBLISH_COMMAND), /docker inspect/)
})

test('adaptive Nginx output reports the selected runtime', () => {
  assert.equal(parseNginxRuntime('__CENDLINK_NGINX_RUNTIME__=docker\n'), 'docker')
  assert.equal(parseNginxRuntime('__CENDLINK_NGINX_RUNTIME__=systemd\n'), 'systemd')
  assert.equal(parseNginxRuntime('custom command output'), '')
})

test('direct proxy targets report a container port mismatch', () => {
  const analysis = analyzeNginxProxyConfig(
    `
      server {
        location /aibox-api/ {
          proxy_pass http://aibox-service:8060/;
        }
      }
    `,
    { containerName: 'aibox-service', containerPort: 8086 },
  )

  assert.equal(analysis.status, 'mismatch')
  assert.equal(analysis.mismatches[0].port, 8060)
  assert.equal(analysis.expected, 'http://aibox-service:8086/')
})

test('direct proxy targets accept the expected container port', () => {
  const analysis = analyzeNginxProxyConfig(
    'server { location / { proxy_pass http://aibox-service:8086/; } }',
    { containerName: 'aibox-service', containerPort: 8086 },
  )

  assert.equal(analysis.status, 'matched')
  assert.equal(analysis.matches.length, 1)
})

test('named upstream targets resolve their backend server port', () => {
  const analysis = analyzeNginxProxyConfig(
    `
      upstream aibox_pool {
        server aibox-service:8086;
      }
      server {
        location /api/ {
          proxy_pass http://aibox_pool;
        }
      }
    `,
    { containerName: 'aibox-service', containerPort: 8086 },
  )

  assert.equal(analysis.status, 'matched')
  assert.equal(analysis.matches[0].type, 'upstream')
})

test('missing and variable proxy targets remain non-fatal diagnostic states', () => {
  assert.equal(
    analyzeNginxProxyConfig('server { return 204; }', {
      containerName: 'aibox-service',
      containerPort: 8086,
    }).status,
    'missing',
  )

  assert.equal(
    analyzeNginxProxyConfig('server { location / { proxy_pass http://$backend; } }', {
      containerName: 'aibox-service',
      containerPort: 8086,
    }).status,
    'unverifiable',
  )
})
