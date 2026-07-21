import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { buildServiceTemplatePayload } from '../src/features/workspace/composables/useWorkspaceSession.js'

test('deployment updates keep the template id and prioritize the edited service name', () => {
  const existing = reactive({
    id: 'service-template-1',
    name: 'aibox-production',
    serviceName: 'aibox-old',
    packageConfig: { serviceName: 'aibox-old', serviceVersion: '1.0.0' },
    deployConfig: { serviceName: 'aibox-old', hostPort: 8060, containerPort: 8086 },
    createdAt: '2026-07-20T10:00:00.000Z',
  })

  const payload = buildServiceTemplatePayload(existing, {
    serviceName: 'aibox-new',
    packageConfig: existing.packageConfig,
    deployConfig: {
      serviceName: 'aibox-new',
      hostPort: 9060,
      containerPort: 9086,
      networkName: 'proxy',
    },
  })

  assert.equal(payload.id, existing.id)
  assert.equal(payload.name, existing.name)
  assert.equal(payload.serviceName, 'aibox-new')
  assert.equal(payload.deployConfig.serviceName, 'aibox-new')
  assert.equal(payload.deployConfig.hostPort, 9060)
  assert.equal(payload.deployConfig.networkName, 'proxy')
  assert.doesNotThrow(() => structuredClone(payload))
})
