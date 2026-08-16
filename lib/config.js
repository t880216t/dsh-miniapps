/**
 * Mini-app list validation shared by the host route and tests. Configuration
 * mistakes fail loud at plugin load instead of surfacing as blank tabs.
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
