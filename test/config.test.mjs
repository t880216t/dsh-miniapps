import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateApps } from '../lib/config.js'

test('accepts a valid list and preserves order and optional icons', () => {
  const apps = validateApps([
    { id: 'mic-ai-agent', name: 'MIC AI代理', url: 'http://10.110.5.239:9098' },
    { id: 'portal', name: 'Portal', url: 'https://example.com', icon: 'https://example.com/icon.png' },
  ])
  assert.deepEqual(apps.map(app => app.id), ['mic-ai-agent', 'portal'])
  assert.equal(apps[0].icon, undefined)
  assert.equal(apps[1].icon, 'https://example.com/icon.png')
})

test('an omitted list is empty, not an error', () => {
  assert.deepEqual(validateApps(undefined), [])
})

test('rejects malformed entries loudly', () => {
  assert.throws(() => validateApps('nope'), /must be a list/)
  assert.throws(() => validateApps([{ id: 'Bad Id', name: 'x', url: 'http://a' }]), /kebab-case/)
  assert.throws(() => validateApps([{ id: 'a', name: '', url: 'http://a' }]), /non-empty/)
  assert.throws(() => validateApps([{ id: 'a', name: 'x', url: 'ftp://a' }]), /http\(s\) URL/)
  assert.throws(() => validateApps([
    { id: 'a', name: 'x', url: 'http://a' },
    { id: 'a', name: 'y', url: 'http://b' },
  ]), /duplicate app id/)
  assert.throws(
    () => validateApps([{ id: 'a', name: 'x', url: 'http://a', icon: 'not-a-url' }]),
    /icon must be/,
  )
})
