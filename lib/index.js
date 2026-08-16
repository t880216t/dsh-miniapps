/**
 * dsh-miniapps host half: the user-editable mini-app list. The configured
 * `apps` are only the first-run defaults; once the user saves a list it lives
 * in `$DSH_HOME/miniapps/apps.json` and that file is the single authority.
 * `GET /plugins/miniapps/config` serves the effective list and
 * `PUT /plugins/miniapps/config` validates and persists a replacement.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateApps } from './config.js'

export const name = 'dsh-miniapps'
export const inject = ['webServer']

/** Largest accepted PUT body; a mini-app list is small by construction. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Path of the user-saved list.
 * @param {Record<string, string | undefined>} env - process environment.
 * @returns {string} the apps.json path under the Harness home.
 */
export function userAppsPath(env = process.env) {
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'miniapps', 'apps.json')
}

/**
 * The effective list: the user's saved file when present, else the presets.
 * @param {string} path - user file path.
 * @param {{ id: string, name: string, url: string, icon?: string }[]} presets - config defaults.
 * @returns {{ id: string, name: string, url: string, icon?: string }[]} the list to serve.
 */
export function readEffectiveApps(path, presets) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return presets
  }
  // A corrupt saved file falls back to the presets instead of a blank surface;
  // the next save overwrites it.
  try {
    return validateApps(JSON.parse(raw).apps)
  } catch {
    return presets
  }
}

function readBody(request, limit) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) rejectPromise(new Error('body too large'))
      else chunks.push(chunk)
    })
    request.on('end', () => { resolvePromise(Buffer.concat(chunks).toString('utf8')) })
    request.on('error', rejectPromise)
  })
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

/**
 * Mount the config route for the browser half.
 * @param {import('cordis').Context} ctx - plugin context carrying `webServer`.
 * @param {{ apps?: unknown } | undefined} config - raw plugin configuration (first-run defaults).
 */
export function apply(ctx, config) {
  const presets = validateApps(config?.apps)
  const path = userAppsPath()
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/miniapps/config',
      handler: (request, response) => {
        if (request.method === 'PUT') {
          readBody(request, MAX_BODY_BYTES)
            .then((body) => {
              const apps = validateApps(JSON.parse(body).apps)
              mkdirSync(dirname(path), { recursive: true })
              writeFileSync(path, JSON.stringify({ apps }, null, 2))
              sendJson(response, 200, { apps })
            })
            .catch((error) => {
              sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
            })
          return
        }
        sendJson(response, 200, { apps: readEffectiveApps(path, presets) })
      },
    }),
    'miniapps: config route',
  )
}
