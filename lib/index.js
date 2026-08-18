/**
 * dsh-miniapps host half: the user-editable mini-app list and the guests'
 * network proxy. The configured `apps` are only the first-run defaults; once
 * the user saves a list it lives in `$DSH_HOME/miniapps/apps.json` and that
 * file is the single authority. `GET /plugins/miniapps/config` serves the
 * effective settings and `PUT /plugins/miniapps/config` validates and
 * persists a replacement.
 *
 * The proxy is global to every mini-app because it belongs to the guest
 * partition, not to a page: under Electron this half applies it to the
 * `persist:miniapps` session, which every guest view shares. A browser
 * deployment has no session to configure and stores the setting unused.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { electronProxyConfig, validateApps, validateProxy } from './config.js'

export const name = 'dsh-miniapps'
export const inject = ['webServer']

/** Largest accepted PUT body; a mini-app list is small by construction. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * The guest partition. The desktop shell owns this string too (it scopes the
 * partition's permission handlers) and the browser half names it on every
 * guest view; all three must agree or the proxy lands on an unused session.
 */
const GUEST_PARTITION = 'persist:miniapps'

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

/**
 * The effective settings: the saved file's list and proxy when present, else
 * the presets and a direct connection.
 * @param {string} path - user file path.
 * @param {{ id: string, name: string, url: string, icon?: string }[]} presets - config defaults.
 * @param {unknown} presetProxy - proxy from the plugin configuration.
 * @returns {{ apps: object[], proxy: { mode: string, url: string, bypassRules: string } }} the settings to serve.
 */
export function readEffectiveSettings(path, presets, presetProxy) {
  let saved
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { apps: presets, proxy: validateProxy(presetProxy) }
  }
  let apps
  try {
    apps = validateApps(saved.apps)
  } catch {
    apps = presets
  }
  // The saved proxy wins even when the list did not survive parsing: the two
  // settings fail independently.
  return { apps, proxy: validateProxy(saved.proxy ?? presetProxy) }
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
 * Point the guest partition at the configured proxy. Electron is absent in a
 * browser deployment and the guests are iframes there, so a missing module is
 * a no-op rather than a failure; a rejected `setProxy` is reported and does
 * not take the plugin down with it.
 * @param {{ mode: string, url: string, bypassRules: string }} proxy - validated settings.
 * @param {{ warn?: (message: string) => void } | undefined} logger - optional plugin logger.
 * @returns {Promise<boolean>} whether a session was configured.
 */
export async function applyGuestProxy(proxy, logger) {
  let electron
  try {
    electron = await import('electron')
  } catch {
    return false
  }
  const runtime = electron.default ?? electron
  if (runtime?.session === undefined) return false
  try {
    // `session.fromPartition` throws before the app is ready, and the profile
    // can activate either side of that line depending on the launcher.
    if (runtime.app?.isReady?.() === false) await runtime.app.whenReady()
    await runtime.session.fromPartition(GUEST_PARTITION).setProxy(electronProxyConfig(proxy))
    return true
  } catch (error) {
    logger?.warn?.(`miniapps: could not apply the guest proxy: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Mount the config route for the browser half and apply the saved proxy.
 * @param {import('cordis').Context} ctx - plugin context carrying `webServer`.
 * @param {{ apps?: unknown, proxy?: unknown } | undefined} config - raw plugin configuration (first-run defaults).
 */
export function apply(ctx, config) {
  const presets = validateApps(config?.apps)
  const presetProxy = config?.proxy
  const path = userAppsPath()
  // The guests read the proxy from their session, not from the page, so the
  // saved setting has to be in force before the first guest attaches.
  void applyGuestProxy(readEffectiveSettings(path, presets, presetProxy).proxy, ctx.logger)
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/miniapps/config',
      handler: (request, response) => {
        if (request.method === 'PUT') {
          readBody(request, MAX_BODY_BYTES)
            .then((body) => {
              const parsed = JSON.parse(body)
              const apps = validateApps(parsed.apps)
              const proxy = validateProxy(parsed.proxy)
              mkdirSync(dirname(path), { recursive: true })
              writeFileSync(path, JSON.stringify({ apps, proxy }, null, 2))
              // Applied on the way out so the answer already describes a live
              // proxy; guests pick it up on their next navigation or reload.
              applyGuestProxy(proxy, ctx.logger)
                .then(() => { sendJson(response, 200, { apps, proxy }) })
                .catch(() => { sendJson(response, 200, { apps, proxy }) })
            })
            .catch((error) => {
              sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
            })
          return
        }
        sendJson(response, 200, readEffectiveSettings(path, presets, presetProxy))
      },
    }),
    'miniapps: config route',
  )
}
