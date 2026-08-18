# dsh-miniapps

为 DeepSeek Harness 增加**用户可配置的小程序**：侧边栏底部的「小程序」入口打开一个**全屏界面**，顶栏在多个已配置的内部 Web 应用间切换（每个应用的页面常驻，切换、收起、重新打开都不丢状态），「管理」视图里可直接增删改名称与地址、配置小程序共用的网络代理并保存。

User-configurable mini apps for DeepSeek Harness: a sidebar-foot entry opens a full-screen surface whose top bar switches between the configured internal web apps (each iframe stays alive across switches); the manage view edits names and URLs in place.

## 安装 / Install

作为 dsh bundle 分发（`dsh.bundle` + `cordis.patch.yml`）。产品组合按提交钉定并将其加入 profile 的 `dsh.profile.bundles`；独立安装可用：

```sh
dsh plugin --profile <name> add dsh-miniapps
```

## 配置 / Configuration

patch 里的 `apps` 只是**首次默认值**；用户在界面里保存后，列表存于 `$DSH_HOME/miniapps/apps.json`，此后以该文件为唯一权威：

```yaml
- id: miniapps
  config:
    apps:
      - id: mic-ai-agent
        name: MIC AI代理
        url: http://10.110.5.239:9098
```

校验规则：kebab-case 唯一 id、非空名称、http(s) URL；违规配置在加载时失败，违规保存返回 400 并保留原列表。

代理与列表存在同一个文件里，`proxy` 亦可作为首次默认值：

```yaml
- id: miniapps
  config:
    proxy:
      mode: custom          # none（默认）/ system / custom
      url: http://127.0.0.1:8888
      bypassRules: '<local>'
```

代理**对所有小程序生效**：它属于小程序共用的 `persist:miniapps` 会话，而不是某一个页面。`custom` 接受 http / https / socks / socks4 / socks5，地址无法解析时按 `none` 处理（不会把上一次的代理留在生效状态）。列表校验会失败，代理校验只会降级——用户看不见的代理比没有代理更糟。

## 机制 / How it works

- **Host 半**（`lib/index.js`，注入 `webServer`）：`GET /plugins/miniapps/config` 返回生效设置（用户文件优先，损坏时回退预置；列表与代理各自独立降级）；`PUT` 校验后写入用户文件。Electron 在场时，启动与每次保存都会把代理施加到 `persist:miniapps` 会话；纯浏览器部署没有会话可配置，设置照常保存但不生效。
- **浏览器半**（`lib/client.js`，注入 `slots`）：向 `sidebar.footer.action` 注册「小程序」入口；全屏覆盖层带顶栏切换、刷新、管理视图。
- **常驻与收起**：覆盖层首次打开后**挂载一次、之后只隐藏**，因此每个打开过的小程序都保留页面、滚动位置与会话；顶栏的 × 是「收起」，关闭单个小程序是其**图标右上角**的 ×（打开中的图标带一个圆点）。关闭单个小程序会丢弃它的页面，下次打开从首页开始。
- **刷新**：顶栏刷新按钮重载当前页面（桌面壳里调 webview 自己的 reload，浏览器里重挂 iframe）。改动代理后已打开的页面会自动重载——会话代理只在下一次导航时才生效。
- **新窗口改为当前窗口**：注入页面的脚本改写 `window.open`、`a[target=_blank]` 点击与 `form[target=_blank]` 提交，使其在当前页面导航；桌面壳另有一层兜底（guest 的 window-open handler 就地导航），因此即使页面在脚本之后重新绑定这些入口，也不会弹出新窗口。
- 纯 JS、零构建、零运行时依赖。

## 限制 / Limitations

- 目标站点若发送 `X-Frame-Options` / CSP `frame-ancestors` 拒绝内嵌，则无法在 iframe 中显示——桌面壳里是 webview guest，不受此限；纯浏览器部署受限。
- 列表与代理按 Harness home 保存（每产品安装一份），不做多用户区分。
- 依赖 opener 回调的弹窗式流程（部分 OAuth 授权）在"新窗口改为当前窗口"下会变成同页跳转。
- 常驻只在应用进程内有效：重启应用后所有小程序都是全新页面。

## License

MIT
