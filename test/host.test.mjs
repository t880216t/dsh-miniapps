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
  })

  for (const dispose of disposers) dispose()
  assert.equal(routes.length, 0)
})

test('a malformed config refuses to mount', () => {
  const { ctx } = fakeContext()
  assert.throws(() => apply(ctx, { apps: [{ id: 'Bad', name: 'x', url: 'http://a' }] }), /kebab-case/)
})
