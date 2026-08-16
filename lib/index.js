/**
 * dsh-miniapps host half: validates the configured mini-app list at load and
 * serves it to the browser half over `GET /plugins/miniapps/config`. The
 * browser half registers one better-sidebar tab per app; everything the page
 * receives comes from this route, so the config is the single authority.
 */

import { validateApps } from './config.js'

export const name = 'dsh-miniapps'
export const inject = ['webServer']

/**
 * Mount the config route for the browser half.
 * @param {import('cordis').Context} ctx - plugin context carrying `webServer`.
 * @param {{ apps?: unknown } | undefined} config - raw plugin configuration.
 */
export function apply(ctx, config) {
  const apps = validateApps(config?.apps)
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/miniapps/config',
      handler: (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ apps }))
      },
    }),
    'miniapps: config route',
  )
}
