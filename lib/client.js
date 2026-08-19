window.__ModuleLoader__.load({
  id: 'dsh-miniapps',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // dsh-miniapps browser half: a sidebar-foot entry opening a full-screen
    // mini-app surface. The top bar switches between the configured apps
    // (each keeps its guest view alive across switches) and hosts the manage
    // view where the user edits names, URLs and the guests' proxy; saves go
    // back to the host.
    //
    // The overlay is mounted once and hidden on close, never unmounted: the
    // sidebar entry is a "show" button, not an "open fresh" one, so every
    // opened app keeps its page, scroll position and session. Closing one app
    // is the × on its own switcher icon.
    const { createElement: h, Fragment, useCallback, useEffect, useRef, useState } = require('react')

    const name = 'dsh-miniapps-client'
    const inject = ['slots']

    const win = globalThis

    /** The proxy settings of a fresh installation (mirrors lib/config.js). */
    const DEFAULT_PROXY = { mode: 'none', url: '', bypassRules: '' }

    function readProxy(value) {
      if (typeof value !== 'object' || value === null) return { ...DEFAULT_PROXY }
      return {
        mode: value.mode === 'system' || value.mode === 'custom' ? value.mode : 'none',
        url: typeof value.url === 'string' ? value.url : '',
        bypassRules: typeof value.bypassRules === 'string' ? value.bypassRules : '',
      }
    }

    async function fetchSettings() {
      const response = await win.fetch('/plugins/miniapps/config')
      if (!response.ok) throw new Error(`config route responded ${response.status}`)
      const body = await response.json()
      return { apps: Array.isArray(body.apps) ? body.apps : [], proxy: readProxy(body.proxy) }
    }

    async function saveSettings(apps, proxy) {
      const response = await win.fetch('/plugins/miniapps/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps, proxy }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `save failed (${response.status})`)
      return { apps: Array.isArray(body.apps) ? body.apps : [], proxy: readProxy(body.proxy) }
    }

    // Inlined from lib/ua.js (the loader factory has no local imports; the
    // node tests cover that copy — keep both in sync): the guest view sends
    // the canonical Chrome UA instead of Electron's tokenized one.
    function standardChromeUserAgent(raw) {
      const platform = /^Mozilla\/5\.0 \(([^)]+)\)/.exec(raw)?.[1]
      const chrome = /Chrome\/([\d.]+)/.exec(raw)?.[1]
      if (platform === undefined || chrome === undefined) return undefined
      return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
    }
    const CHROME_UA = standardChromeUserAgent(win.navigator?.userAgent ?? '')

    /** The switcher icon source: configured icon, else the site's favicon. */
    function appIconUrl(app) {
      if (app.icon !== undefined) return app.icon
      try {
        return new URL('/favicon.ico', new URL(app.url).origin).toString()
      } catch {
        return undefined
      }
    }

    /** Favicon image with the app-grid glyph as the load-failure fallback. */
    function AppIconImg({ app, size }) {
      const [failed, setFailed] = useState(false)
      const src = appIconUrl(app)
      if (failed || src === undefined) return h(AppsIcon, { size })
      return h('img', {
        src,
        alt: '',
        referrerPolicy: 'no-referrer',
        style: { width: size, height: size, borderRadius: 4, objectFit: 'contain', flex: 'none' },
        onError: () => { setFailed(true) },
      })
    }

    // Injected into every guest page: a mini-app is one surface, so a target
    // that would become a second window navigates this one instead. Covers the
    // three ways a page asks for one — window.open, an anchor and a form with
    // target=_blank — synchronously in the page, before the runtime sees a
    // popup request at all. The desktop shell contains whatever slips past
    // (its guest window-open handler navigates in place), so the two halves
    // agree even on a page that rebinds these after load.
    const POPUP_NAVIGATION_SCRIPT = `(() => {
  if (window.__dshMiniappPopupNavigation) return
  window.__dshMiniappPopupNavigation = true
  const navigate = (raw) => {
    if (typeof raw !== 'string' || raw === '') return false
    try {
      const url = new URL(raw, window.location.href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      window.location.assign(url.href)
      return true
    } catch (error) {
      return false
    }
  }
  const open = window.open.bind(window)
  window.open = (url, target, features) => {
    if (typeof url === 'string' && navigate(url)) return null
    // A blank window.open() is a handle the page writes into; leave it alone.
    if (url === undefined || url === null || url === '') return window
    return open(url, target, features)
  }
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return
    const anchor = event.target instanceof Element ? event.target.closest('a[target="_blank"][href]') : null
    if (anchor === null || !navigate(anchor.href)) return
    event.preventDefault()
    event.stopPropagation()
  }, true)
  document.addEventListener('submit', (event) => {
    const form = event.target
    if (form instanceof HTMLFormElement && form.target === '_blank') form.target = '_self'
  }, true)
})()`

    /**
     * One mini-app page. Inside the desktop shell this is an Electron
     * <webview> guest: a first-party context whose cookies persist in the
     * `persist:miniapps` partition across restarts (an iframe would be a
     * third-party context, so SameSite rules drop the site's cookies), sent
     * with the canonical Chrome UA. Plain browsers fall back to a sandboxed
     * iframe.
     *
     * The element is created once per opened app and only its `display`
     * changes: switching apps, hiding the overlay and closing it all keep the
     * page alive. `reloadKey` is the iframe's manual-refresh channel (a
     * remount, since an iframe offers no reload API); a webview reloads
     * through its own method and keeps the same element.
     */
    function GuestView({ app, visible, electron, reloadKey, onElement }) {
      const ref = useRef(null)

      useEffect(() => {
        const guest = ref.current
        if (guest === null) return undefined
        onElement(app.id, guest)
        if (!electron) return () => { onElement(app.id, undefined) }
        const install = () => {
          try {
            const done = guest.executeJavaScript(POPUP_NAVIGATION_SCRIPT, true)
            if (done !== undefined && typeof done.catch === 'function') done.catch(() => {})
          } catch {
            // The guest is not attached yet; dom-ready fires again per page.
          }
        }
        // Electron's own popup path for guests that beat the injected script.
        const navigateInPlace = (event) => {
          if (typeof event.url !== 'string') return
          try {
            guest.loadURL(event.url)
          } catch {
            // A detached guest has nowhere to navigate.
          }
        }
        guest.addEventListener('dom-ready', install)
        guest.addEventListener('new-window', navigateInPlace)
        install()
        return () => {
          guest.removeEventListener('dom-ready', install)
          guest.removeEventListener('new-window', navigateInPlace)
          onElement(app.id, undefined)
        }
      }, [app.id, electron, onElement])

      const style = {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        background: '#fff',
        // display (not visibility): a hidden webview guest layer would keep
        // compositing above its siblings; modern OOPIF guests survive
        // display:none without reloading.
        display: visible ? 'flex' : 'none',
      }
      if (electron) {
        return h('webview', {
          ref,
          src: app.url,
          partition: 'persist:miniapps',
          allowpopups: 'true',
          ...(CHROME_UA === undefined ? {} : { useragent: CHROME_UA }),
          style,
        })
      }
      return h('iframe', {
        ref,
        src: app.url,
        title: app.name,
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals',
        allow: 'clipboard-read; clipboard-write',
        style,
      })
    }

    /** Mint an unused kebab-case id for a user-added app. */
    function nextId(apps) {
      let n = apps.length + 1
      while (apps.some((app) => app.id === `app-${n}`)) n += 1
      return `app-${n}`
    }

    /** Electron marker the product shell stamps on <html>; absent in a plain browser. */
    const desktopPlatform = () => win.document?.documentElement?.dataset?.dshDesktopPlatform

    const barButton = (active) => ({
      WebkitAppRegion: 'no-drag',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 30,
      padding: '0 12px',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      font: 'inherit',
      fontSize: 13,
      color: 'var(--dsw-alias-label-primary, inherit)',
      background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))' : 'transparent',
    })

    const inputStyle = {
      flex: 1,
      minWidth: 0,
      height: 30,
      padding: '0 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border, rgba(127,127,127,.35))',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: 13,
    }

    /** Small print for a section's rules, sitting under the section it explains. */
    const hintStyle = { fontSize: 12, opacity: 0.6, margin: '12px 0 0' }

    /** Rule separating the manage view's sections. */
    const sectionRule = {
      height: 1,
      margin: '24px 0',
      background: 'var(--dsw-alias-border, rgba(127,127,127,.35))',
    }

    // Sections in the order they are used: the app list carrying its own add
    // button, then the shared proxy, then the page-level actions. The proxy
    // used to sit between the list and the buttons, which stranded "add app"
    // in the save row and made a list edit reach past the proxy to be saved.
    function ManageView({ apps, proxy, onSaved, onCancel }) {
      const [draft, setDraft] = useState(apps.map((app) => ({ ...app })))
      const [proxyDraft, setProxyDraft] = useState({ ...proxy })
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const update = (index, key, value) => {
        setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
      }

      return h(
        'div',
        { style: { maxWidth: 720, width: '100%', margin: '32px auto', padding: '0 24px' } },
        h('h2', { style: { fontSize: 16, margin: '0 0 16px' } }, '管理小程序'),
        ...draft.map((row, index) => h(
          'div',
          { key: index, style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
          h('input', {
            style: { ...inputStyle, flex: '0 0 180px' },
            value: row.name,
            placeholder: '名称',
            onChange: (event) => update(index, 'name', event.target.value),
          }),
          h('input', {
            style: inputStyle,
            value: row.url,
            placeholder: 'http(s):// 地址',
            onChange: (event) => update(index, 'url', event.target.value),
          }),
          h('button', {
            type: 'button',
            style: barButton(false),
            onClick: () => { setDraft((rows) => rows.filter((_, i) => i !== index)) },
          }, '删除'),
        )),
        h('button', {
          type: 'button',
          style: { ...barButton(false), marginTop: 4 },
          onClick: () => { setDraft((rows) => [...rows, { id: nextId(rows), name: '', url: '' }]) },
        }, '＋ 添加小程序'),
        h('p', { style: hintStyle },
          '地址须为 http(s) URL；目标站点若禁止内嵌（X-Frame-Options / frame-ancestors）将无法显示。'),
        h('div', { style: sectionRule }),
        h('h2', { style: { fontSize: 16, margin: '0 0 6px' } }, '网络代理'),
        h('p', { style: { fontSize: 12, opacity: 0.6, margin: '0 0 12px' } },
          '代理对所有小程序生效——它属于小程序共用的会话，而不是某一个页面。保存后已打开的页面会自动重新加载。'),
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
          ...[['none', '不使用'], ['system', '跟随系统'], ['custom', '自定义']].map(([mode, label]) => h('button', {
            key: mode,
            type: 'button',
            'aria-pressed': proxyDraft.mode === mode ? 'true' : 'false',
            style: barButton(proxyDraft.mode === mode),
            onClick: () => { setProxyDraft((current) => ({ ...current, mode })) },
          }, label))),
        proxyDraft.mode === 'custom'
          ? h(Fragment, null,
              h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
                h('span', { style: { flex: '0 0 180px', fontSize: 13, opacity: 0.75 } }, '代理地址'),
                h('input', {
                  style: inputStyle,
                  value: proxyDraft.url,
                  placeholder: 'http://host:port（也支持 https / socks5）',
                  onChange: (event) => { setProxyDraft((current) => ({ ...current, url: event.target.value })) },
                })),
              h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
                h('span', { style: { flex: '0 0 180px', fontSize: 13, opacity: 0.75 } }, '绕过规则（可选）'),
                h('input', {
                  style: inputStyle,
                  value: proxyDraft.bypassRules,
                  placeholder: '<local>;*.internal.example.com',
                  onChange: (event) => { setProxyDraft((current) => ({ ...current, bypassRules: event.target.value })) },
                })))
          : null,
        h('p', { style: hintStyle }, '自定义代理地址无法解析时按不使用代理处理。'),
        h('div', { style: sectionRule }),
        // The failure reads above the buttons: below them it fell outside the
        // eye's path back from the click.
        error === '' ? null : h('p', { style: { color: '#d33', fontSize: 13, margin: '0 0 12px' } }, error),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          h('button', { key: 'cancel', type: 'button', style: barButton(false), onClick: onCancel }, '取消'),
          h('button', {
            key: 'save',
            type: 'button',
            style: { ...barButton(true), fontWeight: 600 },
            disabled: busy,
            onClick: () => {
              setBusy(true)
              setError('')
              saveSettings(draft, proxyDraft)
                .then((saved) => { onSaved(saved) })
                .catch((cause) => { setError(String(cause.message ?? cause)); setBusy(false) })
            },
          }, busy ? '保存中…' : '保存'),
        ),
      )
    }

    /**
     * One switcher icon. An opened app carries a dot, and its × sits on the
     * icon's top-right corner on hover or focus — closing one app is a
     * per-app act, distinct from collapsing the whole surface.
     */
    function SwitcherIcon({ app, active, opened, onActivate, onClose }) {
      const [hovered, setHovered] = useState(false)
      const [focused, setFocused] = useState(false)
      const showClose = opened && (hovered || focused)

      return h(
        'span',
        {
          style: { position: 'relative', flex: 'none', display: 'inline-flex' },
          onMouseEnter: () => { setHovered(true) },
          onMouseLeave: () => { setHovered(false) },
        },
        h('button', {
          type: 'button',
          title: app.name,
          'aria-label': app.name,
          'aria-current': active ? 'true' : undefined,
          style: {
            ...barButton(active),
            width: 36,
            height: 36,
            padding: 0,
            justifyContent: 'center',
            flex: 'none',
          },
          onClick: onActivate,
          onFocus: () => { setFocused(true) },
          onBlur: () => { setFocused(false) },
        }, h(AppIconImg, { app, size: 20 })),
        opened && !showClose
          ? h('span', {
              'aria-hidden': true,
              style: {
                position: 'absolute',
                right: 3,
                top: 3,
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
                pointerEvents: 'none',
              },
            })
          : null,
        showClose
          ? h('button', {
              type: 'button',
              title: `关闭 ${app.name}`,
              'aria-label': `关闭 ${app.name}`,
              style: {
                WebkitAppRegion: 'no-drag',
                position: 'absolute',
                right: -2,
                top: -2,
                width: 14,
                height: 14,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 11,
                lineHeight: '14px',
                color: 'var(--dsw-alias-bg-primary, #fff)',
                background: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.55))',
              },
              onClick: (event) => {
                // The icon underneath would activate the app being closed.
                event.stopPropagation()
                onClose()
              },
              onFocus: () => { setFocused(true) },
              onBlur: () => { setFocused(false) },
            }, '×')
          : null,
      )
    }

    /** Circular-arrow glyph in the top bar's 16px line-art idiom. */
    function RefreshIcon({ size }) {
      return h(
        'svg',
        {
          'aria-hidden': true,
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flex: 'none' },
        },
        h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.7-3.97' }),
        h('path', { d: 'M13.5 2.5v3.2h-3.2' }),
      )
    }

    function MiniAppsOverlay({ hidden, onClose }) {
      const [apps, setApps] = useState(undefined)
      const [proxy, setProxy] = useState(DEFAULT_PROXY)
      const [activeId, setActiveId] = useState(undefined)
      const [openedIds, setOpenedIds] = useState([])
      const [managing, setManaging] = useState(false)
      const [reloadKeys, setReloadKeys] = useState({})
      // Live guest elements by app id, for the manual refresh. A ref, not
      // state: registering one must not re-render the surface it belongs to.
      const guests = useRef(new Map())

      const reload = useCallback(() => {
        fetchSettings()
          .then((settings) => {
            setApps(settings.apps)
            setProxy(settings.proxy)
            setActiveId((current) => {
              const still = settings.apps.some((app) => app.id === current) ? current : settings.apps[0]?.id
              if (still !== undefined) setOpenedIds((ids) => (ids.includes(still) ? ids : [...ids, still]))
              return still
            })
            setManaging(settings.apps.length === 0)
          })
          .catch(() => { setApps([]) })
      }, [])

      useEffect(() => { reload() }, [reload])
      useEffect(() => {
        // Only the visible overlay answers Escape; hidden, it is not on screen
        // and the key belongs to whatever the user is actually looking at.
        if (hidden) return undefined
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        win.document.addEventListener('keydown', onKey)
        return () => { win.document.removeEventListener('keydown', onKey) }
      }, [hidden, onClose])

      const onElement = useCallback((id, element) => {
        if (element === undefined) guests.current.delete(id)
        else guests.current.set(id, element)
      }, [])

      const activate = (id) => {
        setActiveId(id)
        setManaging(false)
        setOpenedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
      }

      // Closing one app discards its guest: the next open starts fresh, which
      // is the only way back to a first page once a mini-app has wandered.
      const closeApp = (id) => {
        const rest = openedIds.filter((opened) => opened !== id)
        setOpenedIds(rest)
        if (activeId === id) setActiveId(rest[rest.length - 1])
      }

      /** Reload the visible page: the guest's own reload, or an iframe remount. */
      const refreshActive = () => {
        if (activeId === undefined) return
        const guest = guests.current.get(activeId)
        if (guest !== undefined && typeof guest.reload === 'function') {
          try {
            guest.reload()
            return
          } catch {
            // A detached guest falls through to the remount below.
          }
        }
        setReloadKeys((keys) => ({ ...keys, [activeId]: (keys[activeId] ?? 0) + 1 }))
      }

      /** Reload every live guest: used when a setting they all share changes. */
      const refreshAll = () => {
        const remount = []
        for (const id of openedIds) {
          const guest = guests.current.get(id)
          if (guest !== undefined && typeof guest.reload === 'function') {
            try {
              guest.reload()
              continue
            } catch {
              // Fall through to the remount below.
            }
          }
          remount.push(id)
        }
        if (remount.length === 0) return
        setReloadKeys((keys) => {
          const next = { ...keys }
          for (const id of remount) next[id] = (next[id] ?? 0) + 1
          return next
        })
      }

      return h(
        'div',
        {
          // aria-modal engages the DSH shell's drag-region suspension: the
          // shell's own title-bar drag strips come LATER in document order
          // than this overlay (it mounts in the sidebar subtree), so their
          // drag rects re-union over the bar's no-drag holes and the top bar
          // gets no pointer input. The suspension no-drags every stylesheet
          // target while a modal is mounted; this overlay's inline styles
          // still win, keeping the bar itself draggable.
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '小程序',
          'aria-hidden': hidden ? 'true' : undefined,
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147482000,
            // Hidden, not unmounted: every opened guest keeps its page. The
            // guests survive display:none, which is what makes reopening a
            // restore rather than a fresh load.
            display: hidden ? 'none' : 'flex',
            flexDirection: 'column',
            background: 'var(--dsw-alias-bg-primary, #fff)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            // The frameless desktop shell drags the window from the top strip;
            // the overlay must opt back out or its top bar swallows clicks.
            WebkitAppRegion: 'no-drag',
          },
        },
        h(
          'div',
          {
            style: {
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 44,
              // macOS hiddenInset keeps the native traffic lights at the top
              // left; the bar starts after them. Windows draws the caption
              // controls (min/max/close) as a native overlay over the page's
              // top-RIGHT corner (the shell reserves 138px for it, matching
              // ui-conversation's --dsh-windows-caption-controls-width), so
              // the bar ends before them.
              padding: desktopPlatform() === 'darwin'
                ? '0 10px 0 88px'
                : (desktopPlatform() === 'win32' ? '0 148px 0 10px' : '0 10px'),
              borderBottom: '1px solid var(--dsw-alias-border, rgba(127,127,127,.25))',
              // The overlay hides the app's own drag strip; the bar takes over
              // as the window drag surface while its buttons opt back out.
              WebkitAppRegion: desktopPlatform() === undefined ? undefined : 'drag',
            },
          },
          h('span', { style: { fontSize: 13, fontWeight: 600, padding: '0 8px', flex: 'none' } }, '小程序'),
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 0,
                overflowX: 'auto',
                scrollbarWidth: 'none',
              },
            },
            ...(apps ?? []).map((app) => h(SwitcherIcon, {
              key: app.id,
              app,
              active: !managing && app.id === activeId,
              opened: openedIds.includes(app.id),
              onActivate: () => { activate(app.id) },
              onClose: () => { closeApp(app.id) },
            })),
          ),
          h('span', { style: { flex: 1 } }),
          h('button', {
            type: 'button',
            title: '刷新当前页面',
            'aria-label': '刷新当前页面',
            disabled: managing || activeId === undefined,
            style: {
              ...barButton(false),
              width: 32,
              justifyContent: 'center',
              padding: 0,
              opacity: managing || activeId === undefined ? 0.4 : 1,
            },
            onClick: refreshActive,
          }, h(RefreshIcon, { size: 15 })),
          h('button', { type: 'button', style: barButton(managing), onClick: () => { setManaging(true) } }, '管理'),
          h('button', {
            type: 'button',
            // The surface goes away, the pages do not; the × on an app's own
            // icon is what closes that app.
            title: '收起（保留已打开的小程序）',
            'aria-label': '收起',
            style: { ...barButton(false), width: 32, justifyContent: 'center', fontSize: 17, padding: 0 },
            onClick: onClose,
          }, '×'),
        ),
        h(
          'div',
          { style: { flex: 1, minHeight: 0, position: 'relative' } },
          managing || apps === undefined
            ? null
            : (apps.length === 0
                ? h('p', { style: { textAlign: 'center', marginTop: 80, opacity: 0.6 } }, '尚未配置小程序，点击右上角「管理」添加。')
                : (activeId === undefined
                    ? h('p', { style: { textAlign: 'center', marginTop: 80, opacity: 0.6 } }, '点击上方图标打开小程序。')
                    : null)),
          ...(apps ?? [])
            .filter((app) => openedIds.includes(app.id))
            .map((app) => h(GuestView, {
              key: `${app.id}:${reloadKeys[app.id] ?? 0}`,
              app,
              visible: !managing && app.id === activeId,
              electron: desktopPlatform() !== undefined,
              reloadKey: reloadKeys[app.id] ?? 0,
              onElement,
            })),
          managing && apps !== undefined
            ? h('div', {
                style: { position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--dsw-alias-bg-primary, #fff)' },
              }, h(ManageView, {
                apps,
                proxy,
                onCancel: () => { setManaging(apps.length === 0) },
                onSaved: (saved) => {
                  const proxyChanged = saved.proxy.mode !== proxy.mode
                    || saved.proxy.url !== proxy.url
                    || saved.proxy.bypassRules !== proxy.bypassRules
                  setApps(saved.apps)
                  setProxy(saved.proxy)
                  // Deleted apps lose their guest; a surviving one keeps its page.
                  const survivors = openedIds.filter((id) => saved.apps.some((app) => app.id === id))
                  const still = saved.apps.some((app) => app.id === activeId) ? activeId : saved.apps[0]?.id
                  setOpenedIds(still !== undefined && !survivors.includes(still) ? [...survivors, still] : survivors)
                  setActiveId(still)
                  setManaging(saved.apps.length === 0)
                  // A session proxy only reaches a page on its next navigation,
                  // so a changed one reloads every live guest rather than
                  // leaving pages on the old route until the user notices.
                  if (proxyChanged) refreshAll()
                },
              }))
            : null,
        ),
      )
    }

    // Stroke app-grid icon matching the sidebar's Settings-gear icon style
    // (16px line art riding currentColor).
    function AppsIcon({ size }) {
      return h(
        'svg',
        {
          'aria-hidden': true,
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flex: 'none' },
        },
        h('rect', { x: 2, y: 2, width: 5, height: 5, rx: 1.2 }),
        h('rect', { x: 9, y: 2, width: 5, height: 5, rx: 1.2 }),
        h('rect', { x: 2, y: 9, width: 5, height: 5, rx: 1.2 }),
        h('rect', { x: 9, y: 9, width: 5, height: 5, rx: 1.2 }),
      )
    }

    function FootAction(props) {
      const wide = props?.wide !== false
      const [open, setOpen] = useState(false)
      // Mounted on the first open and never unmounted afterwards: this entry
      // shows and hides one long-lived surface, so the guests it holds keep
      // their pages between visits.
      const [mounted, setMounted] = useState(false)
      const [hovered, setHovered] = useState(false)

      // The foot rhythm shared by the sidebar's Settings trigger.
      const style = {
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        border: 'none',
        cursor: 'pointer',
        overflow: 'hidden',
        fontFamily: 'inherit',
        color: 'var(--dsw-alias-label-primary, inherit)',
        background: open || hovered ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))' : 'transparent',
        ...(wide
          ? {
              flex: '1 0 100%',
              gap: 8,
              width: 'calc(100% + 8px)',
              height: 34,
              margin: '0 -4px',
              padding: '6px 2px 6px 10px',
              borderRadius: 12,
              fontSize: 14,
              lineHeight: '22px',
            }
          : {
              flex: 'none',
              justifyContent: 'center',
              width: 36,
              height: 36,
              margin: 0,
              padding: 0,
              borderRadius: '50%',
            }),
      }

      // Fragment, not a wrapper div: the sidebar's footer-action slot lays its
      // occupants out as flex items, so the button must BE the flex item for
      // its `flex: 1 0 100%` row sizing to apply — inside a content-sized
      // wrapper only the icon+label pill would be clickable. The overlay is
      // position:fixed, so mounting it as a slot sibling changes no layout.
      return h(
        Fragment,
        null,
        h('button', {
          type: 'button',
          title: '小程序',
          style,
          onClick: () => { setMounted(true); setOpen(true) },
          onMouseEnter: () => { setHovered(true) },
          onMouseLeave: () => { setHovered(false) },
        },
        h(AppsIcon, { size: wide ? 16 : 18 }),
        wide ? h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '小程序') : null),
        mounted ? h(MiniAppsOverlay, { hidden: !open, onClose: () => { setOpen(false) } }) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'miniapps-entry',
        order: 90,
        label: '小程序',
      }, FootAction))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    // Exported for the loader's consumers and for rendering these surfaces
    // outside the shell, the way the sibling skill-manager bundle does.
    exports.FootAction = FootAction
    exports.MiniAppsOverlay = MiniAppsOverlay
    exports.ManageView = ManageView
    exports.SwitcherIcon = SwitcherIcon
    return module.exports
  },
})
