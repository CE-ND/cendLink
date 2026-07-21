import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { buildFrontendProjectPayload } from '../src/features/workspace/composables/useWorkspaceSession.js'

test('frontend project updates keep the id, accept the edited name, and remain cloneable', () => {
  const existing = reactive({
    id: 'frontend-project-1',
    name: 'console-web-old',
    projectDir: 'console-web-old',
    lastPackagePath: 'C:/packages/console-web.zip',
    lastUploadedAt: '2026-07-20T10:00:00.000Z',
    lastServerId: 'server-1',
    createdAt: '2026-07-20T09:00:00.000Z',
  })

  const payload = buildFrontendProjectPayload(existing, {
    name: 'console-web-new',
  })

  assert.equal(payload.id, existing.id)
  assert.equal(payload.name, 'console-web-new')
  assert.equal(payload.lastUploadedAt, existing.lastUploadedAt)
  assert.doesNotThrow(() => structuredClone(payload))
})
