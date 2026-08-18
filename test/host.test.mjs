import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, inject, name } from '../lib/index.js'

function fakeContext() {
  const routes = []
  const disposers = []
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
    },
    effect(installer) {
      const dispose = installer()
      disposers.push(dispose)
      return dispose
    },
  }
  return { ctx, routes, disposers }
}

function respond(route) {
  let status
  let headers
  let body
  route.handler({}, {
    writeHead(s, h) { status = s; headers = h },
    end(b) { body = b },
  })
  return { status, headers, body }
}

test('exports the function-plugin face', () => {
  assert.equal(name, 'dsh-miniapps')
  assert.deepEqual(inject, ['webServer'])
})

test('serves the validated app list as JSON and disposal removes the route', () => {
  const { ctx, routes, disposers } = fakeContext()
  apply(ctx, { apps: [{ id: 'mic-ai-agent', name: 'MIC AI代理', url: 'http://10.110.5.239:9098' }] })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, '/plugins/miniapps/config')

  const { status, headers, body } = respond(routes[0])
  assert.equal(status, 200)
  assert.match(headers['Content-Type'], /application\/json/)
  assert.deepEqual(JSON.parse(body), {
    apps: [{ id: 'mic-ai-agent', name: 'MIC AI代理', url: 'http://10.110.5.239:9098' }],
    proxy: { mode: 'none', url: '', bypassRules: '' },
  })

  for (const dispose of disposers) dispose()
  assert.equal(routes.length, 0)
})

test('a malformed config refuses to mount', () => {
  const { ctx } = fakeContext()
  assert.throws(() => apply(ctx, { apps: [{ id: 'Bad', name: 'x', url: 'http://a' }] }), /kebab-case/)
})

test('PUT persists a validated list under DSH_HOME and GET serves it back', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { EventEmitter } = await import('node:events')
  const home = mkdtempSync(join(tmpdir(), 'miniapps-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, routes } = fakeContext()
    apply(ctx, { apps: [{ id: 'preset', name: 'Preset', url: 'http://preset' }] })
    const route = routes[0]

    const put = new EventEmitter()
    put.method = 'PUT'
    let putStatus, putBody
    const done = new Promise((resolveDone) => {
      route.handler(put, {
        writeHead(s) { putStatus = s },
        end(b) { putBody = b; resolveDone() },
      })
    })
    put.emit('data', Buffer.from(JSON.stringify({ apps: [{ id: 'mine', name: '我的', url: 'https://example.com' }] })))
    put.emit('end')
    await done
    assert.equal(putStatus, 200)
    assert.deepEqual(JSON.parse(putBody).apps.map(a => a.id), ['mine'])

    const { body } = respond(route)
    assert.deepEqual(JSON.parse(body).apps.map(a => a.id), ['mine'])
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('PUT rejects an invalid list with a 400 and keeps the effective list', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { EventEmitter } = await import('node:events')
  const home = mkdtempSync(join(tmpdir(), 'miniapps-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, routes } = fakeContext()
    apply(ctx, { apps: [{ id: 'preset', name: 'Preset', url: 'http://preset' }] })
    const route = routes[0]
    const put = new EventEmitter()
    put.method = 'PUT'
    let status, body
    const done = new Promise((resolveDone) => {
      route.handler(put, { writeHead(s) { status = s }, end(b) { body = b; resolveDone() } })
    })
    put.emit('data', Buffer.from(JSON.stringify({ apps: [{ id: 'Bad Id', name: 'x', url: 'ftp://x' }] })))
    put.emit('end')
    await done
    assert.equal(status, 400)
    assert.match(JSON.parse(body).error, /kebab-case/)
    const after = respond(route)
    assert.deepEqual(JSON.parse(after.body).apps.map(a => a.id), ['preset'])
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})
