window.__ModuleLoader__.load({
  id: 'dsh-miniapps',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // dsh-miniapps browser half: a sidebar-foot entry opening a full-screen
    // mini-app surface. The top bar switches between the configured apps
    // (each keeps its iframe alive across switches) and hosts the manage
    // view where the user edits names and URLs; saves go back to the host.
    const { createElement: h, useCallback, useEffect, useState } = require('react')

    const name = 'dsh-miniapps-client'
    const inject = ['slots']

    const win = globalThis

    async function fetchApps() {
      const response = await win.fetch('/plugins/miniapps/config')
      if (!response.ok) throw new Error(`config route responded ${response.status}`)
      const body = await response.json()
      return Array.isArray(body.apps) ? body.apps : []
    }

    async function saveApps(apps) {
      const response = await win.fetch('/plugins/miniapps/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `save failed (${response.status})`)
      return Array.isArray(body.apps) ? body.apps : []
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

    /**
     * One mini-app page. Inside the desktop shell this is an Electron
     * <webview> guest: a first-party context whose cookies persist in the
     * `persist:miniapps` partition across restarts (an iframe would be a
     * third-party context, so SameSite rules drop the site's cookies), sent
     * with the canonical Chrome UA. Plain browsers fall back to a sandboxed
     * iframe. Hidden guests keep `visibility: hidden` — `display: none`
     * detaches a webview and reloads the page on return.
     */
    function guestView(app, visible, electron) {
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
          key: `wv-${app.id}`,
          src: app.url,
          partition: 'persist:miniapps',
          allowpopups: 'true',
          ...(CHROME_UA === undefined ? {} : { useragent: CHROME_UA }),
          style,
        })
      }
      return h('iframe', {
        key: `if-${app.id}`,
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

    function ManageView({ apps, onSaved, onCancel }) {
      const [draft, setDraft] = useState(apps.map((app) => ({ ...app })))
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
        h('div', { style: { display: 'flex', gap: 8, marginTop: 16 } }, [
          h('button', {
            key: 'add',
            type: 'button',
            style: barButton(false),
            onClick: () => { setDraft((rows) => [...rows, { id: nextId(rows), name: '', url: '' }]) },
          }, '＋ 添加小程序'),
          h('span', { key: 'sp', style: { flex: 1 } }),
          h('button', { key: 'cancel', type: 'button', style: barButton(false), onClick: onCancel }, '取消'),
          h('button', {
            key: 'save',
            type: 'button',
            style: { ...barButton(true), fontWeight: 600 },
            disabled: busy,
            onClick: () => {
              setBusy(true)
              setError('')
              saveApps(draft)
                .then((saved) => { onSaved(saved) })
                .catch((cause) => { setError(String(cause.message ?? cause)); setBusy(false) })
            },
          }, busy ? '保存中…' : '保存'),
        ]),
        error === '' ? null : h('p', { style: { color: '#d33', fontSize: 13, marginTop: 12 } }, error),
        h('p', { style: { fontSize: 12, opacity: 0.6, marginTop: 20 } },
          '地址须为 http(s) URL；目标站点若禁止内嵌（X-Frame-Options / frame-ancestors）将无法显示。'),
      )
    }

    function MiniAppsOverlay({ onClose }) {
      const [apps, setApps] = useState(undefined)
      const [activeId, setActiveId] = useState(undefined)
      const [openedIds, setOpenedIds] = useState([])
      const [managing, setManaging] = useState(false)

      const reload = useCallback(() => {
        fetchApps()
          .then((list) => {
            setApps(list)
            setActiveId((current) => {
              const still = list.some((app) => app.id === current) ? current : list[0]?.id
              if (still !== undefined) setOpenedIds((ids) => (ids.includes(still) ? ids : [...ids, still]))
              return still
            })
            setManaging(list.length === 0)
          })
          .catch(() => { setApps([]) })
      }, [])

      useEffect(() => { reload() }, [reload])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        win.document.addEventListener('keydown', onKey)
        return () => { win.document.removeEventListener('keydown', onKey) }
      }, [onClose])

      const activate = (id) => {
        setActiveId(id)
        setManaging(false)
        setOpenedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
      }

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147482000,
            display: 'flex',
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
              // left; the bar starts after them. Windows ships a native frame,
              // so no control overlay reaches the page there.
              padding: desktopPlatform() === 'darwin' ? '0 10px 0 88px' : '0 10px',
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
            ...(apps ?? []).map((app) => h('button', {
              key: app.id,
              type: 'button',
              title: app.name,
              'aria-label': app.name,
              'aria-current': !managing && app.id === activeId ? 'true' : undefined,
              style: {
                ...barButton(!managing && app.id === activeId),
                width: 36,
                height: 36,
                padding: 0,
                justifyContent: 'center',
                flex: 'none',
              },
              onClick: () => { activate(app.id) },
            }, h(AppIconImg, { app, size: 20 }))),
          ),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: barButton(managing), onClick: () => { setManaging(true) } }, '管理'),
          h('button', {
            type: 'button',
            title: '关闭',
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
                : null),
          ...(apps ?? [])
            .filter((app) => openedIds.includes(app.id))
            .map((app) => guestView(app, !managing && app.id === activeId, desktopPlatform() !== undefined)),
          managing && apps !== undefined
            ? h('div', {
                style: { position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--dsw-alias-bg-primary, #fff)' },
              }, h(ManageView, {
                apps,
                onCancel: () => { setManaging(apps.length === 0) },
                onSaved: (saved) => {
                  setApps(saved)
                  const still = saved.some((app) => app.id === activeId) ? activeId : saved[0]?.id
                  setActiveId(still)
                  if (still !== undefined) setOpenedIds((ids) => (ids.includes(still) ? ids : [...ids, still]))
                  setManaging(saved.length === 0)
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

      return h(
        'div',
        null,
        h('button', {
          type: 'button',
          title: '小程序',
          style,
          onClick: () => { setOpen(true) },
          onMouseEnter: () => { setHovered(true) },
          onMouseLeave: () => { setHovered(false) },
        },
        h(AppsIcon, { size: wide ? 16 : 18 }),
        wide ? h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '小程序') : null),
        open ? h(MiniAppsOverlay, { onClose: () => { setOpen(false) } }) : null,
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
    return module.exports
  },
})
