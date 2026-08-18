/**
 * Mini-app list and proxy validation shared by the host route and tests.
 * Configuration mistakes fail loud at plugin load instead of surfacing as
 * blank tabs.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * Validate the configured mini-app list.
 * @param {unknown} value - raw `apps` config value.
 * @returns {{ id: string, name: string, url: string, icon?: string }[]} the validated list.
 */
export function validateApps(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('miniapps: `apps` must be a list')
  const seen = new Set()
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError(`miniapps: apps[${index}] must be an object`)
    }
    const { id, name, url, icon } = entry
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new TypeError(`miniapps: apps[${index}].id must be a kebab-case identifier`)
    }
    if (seen.has(id)) throw new TypeError(`miniapps: duplicate app id ${JSON.stringify(id)}`)
    seen.add(id)
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError(`miniapps: apps[${index}].name must be a non-empty string`)
    }
    if (typeof url !== 'string' || !isHttpUrl(url)) {
      throw new TypeError(`miniapps: apps[${index}].url must be an http(s) URL`)
    }
    if (icon !== undefined && (typeof icon !== 'string' || !isHttpUrl(icon))) {
      throw new TypeError(`miniapps: apps[${index}].icon must be an http(s) URL when given`)
    }
    return icon === undefined ? { id, name, url } : { id, name, url, icon }
  })
}

/**
 * Whether a string parses as an http or https URL.
 * @param {string} value - candidate URL.
 * @returns {boolean} true for http(s) URLs.
 */
export function isHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Proxy protocols Chromium's network stack accepts for a fixed server. */
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:'])

/** The proxy settings of a fresh installation: guests reach the network directly. */
export const DEFAULT_PROXY = { mode: 'none', url: '', bypassRules: '' }

/**
 * Validate the mini-app proxy settings. Unlike the app list this is tolerant:
 * an unreadable saved value degrades to "no proxy" rather than blanking the
 * surface, because a proxy the user cannot see is worse than no proxy.
 * @param {unknown} value - raw `proxy` value from config or the saved file.
 * @returns {{ mode: 'none' | 'system' | 'custom', url: string, bypassRules: string }} the settings.
 */
export function validateProxy(value) {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PROXY }
  const { mode, url, bypassRules } = value
  const settled = mode === 'system' || mode === 'custom' ? mode : 'none'
  const address = typeof url === 'string' ? url.trim() : ''
  const bypass = typeof bypassRules === 'string' ? bypassRules.trim() : ''
  // A custom mode without a usable address would silently mean "direct"; keep
  // the address the user typed so the manage view can show what is wrong.
  return { mode: settled, url: address, bypassRules: bypass }
}

/**
 * Whether a string names a proxy server Chromium can be pointed at.
 * @param {string} value - candidate proxy URL.
 * @returns {boolean} true for an http/https/socks(4|5) URL with a host.
 */
export function isProxyUrl(value) {
  try {
    const parsed = new URL(value)
    return PROXY_PROTOCOLS.has(parsed.protocol) && parsed.hostname !== ''
  } catch {
    return false
  }
}

/**
 * Translate the settings into Electron's `session.setProxy` configuration.
 * `custom` without a usable address falls back to a direct connection instead
 * of leaving the previous proxy in place.
 * @param {{ mode: string, url: string, bypassRules: string }} proxy - validated settings.
 * @returns {{ mode: string, proxyRules?: string, proxyBypassRules?: string }} the Electron config.
 */
export function electronProxyConfig(proxy) {
  if (proxy.mode === 'system') return { mode: 'system' }
  if (proxy.mode === 'custom' && isProxyUrl(proxy.url)) {
    return {
      mode: 'fixed_servers',
      proxyRules: proxy.url,
      ...(proxy.bypassRules === '' ? {} : { proxyBypassRules: proxy.bypassRules }),
    }
  }
  return { mode: 'direct' }
}
