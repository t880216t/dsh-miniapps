/**
 * Standard-Chrome user agent derived from the runtime's own UA. Electron
 * appends `<App>/<version>` and `Electron/<version>` tokens that some sites
 * treat as non-standard clients; the guest view sends the canonical Chrome
 * form instead.
 */

/**
 * Rebuild the canonical Chrome UA from a raw user-agent string.
 * @param {string} raw - `navigator.userAgent` of the embedding runtime.
 * @returns {string | undefined} the canonical UA, or `undefined` when the raw
 * string carries no platform segment or Chrome token to rebuild from.
 */
export function standardChromeUserAgent(raw) {
  const platform = /^Mozilla\/5\.0 \(([^)]+)\)/.exec(raw)?.[1]
  const chrome = /Chrome\/([\d.]+)/.exec(raw)?.[1]
  if (platform === undefined || chrome === undefined) return undefined
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}
