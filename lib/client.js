window.__ModuleLoader__.load({
  id: 'dsh-miniapps',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // dsh-miniapps browser half: reads the host-validated app list and
    // registers one better-sidebar tab per mini app. Each tab renders the
    // app in a sandboxed iframe, like the workbench's embedded browser.
    const { createElement: h } = require('react')

    const name = 'dsh-miniapps-client'
    const inject = ['betterSidebar']

    /** Sort base keeping mini apps after the built-in workbench tabs. */
    const ORDER_BASE = 120

    function appIcon(app) {
      if (app.icon !== undefined) {
        return h('img', {
          src: app.icon,
          alt: '',
          style: { width: 16, height: 16, borderRadius: 3, flex: 'none' },
        })
      }
      return h('span', { 'aria-hidden': true, style: { fontSize: 14, lineHeight: 1 } }, '🧩')
    }

    function appView(app) {
      return () => h('iframe', {
        src: app.url,
        title: app.name,
        // The page is an independent site; keep it in the platform iframe
        // sandbox the workbench browser uses, without top-navigation reach.
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals',
        allow: 'clipboard-read; clipboard-write',
        style: { width: '100%', height: '100%', border: 'none', background: '#fff', display: 'block' },
      })
    }

    function apply(ctx) {
      ctx.effect(() => {
        let disposed = false
        const disposers = []
        fetch('/plugins/miniapps/config')
          .then((response) => (response.ok ? response.json() : { apps: [] }))
          .then((config) => {
            if (disposed || !Array.isArray(config.apps)) return
            config.apps.forEach((app, index) => {
              disposers.push(ctx.betterSidebar.registerTab({
                id: `miniapp:${app.id}`,
                title: () => app.name,
                icon: appIcon(app),
                order: ORDER_BASE + index,
                single: true,
                component: appView(app),
              }))
            })
          })
          .catch(() => {
            // An unreachable host leaves the + menu without mini apps; the
            // next full page load retries.
          })
        return () => {
          disposed = true
          for (const dispose of disposers) dispose()
        }
      })
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  },
})
