import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeNginxProxyConfig,
  buildDockerNginxPublishCommand,
  buildNginxProxyTarget,
  resolveDockerNetworkConfig,
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
