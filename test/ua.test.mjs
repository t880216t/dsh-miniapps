import assert from 'node:assert/strict'
import { test } from 'node:test'
import { standardChromeUserAgent } from '../lib/ua.js'

test('strips the Electron and product tokens into a canonical Chrome UA', () => {
  const raw = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Supertester/0.1.0-rc.5 Chrome/142.0.7444.52 Electron/43.4.0 Safari/537.36'
  assert.equal(
    standardChromeUserAgent(raw),
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.52 Safari/537.36',
  )
})

test('keeps the Windows platform segment', () => {
  const raw = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Supertester/0.1.0 Chrome/142.0.0.0 Electron/43.4.0 Safari/537.36'
  assert.equal(
    standardChromeUserAgent(raw),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  )
})

test('yields undefined when the UA cannot be rebuilt', () => {
  assert.equal(standardChromeUserAgent('curl/8.0'), undefined)
})
