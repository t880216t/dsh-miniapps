# dsh-miniapps

为 DeepSeek Harness 增加**用户可配置的小程序**：侧边栏底部的「小程序」入口打开一个**全屏界面**，顶栏在多个已配置的内部 Web 应用间切换（每个应用的 iframe 常驻、切换不丢状态），「管理」视图里可直接增删改名称与地址并保存。

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

## 机制 / How it works

- **Host 半**（`lib/index.js`，注入 `webServer`）：`GET /plugins/miniapps/config` 返回生效列表（用户文件优先，损坏时回退预置）；`PUT` 校验后写入用户文件。
- **浏览器半**（`lib/client.js`，注入 `slots`）：向 `sidebar.footer.action` 注册「小程序」入口；全屏覆盖层带顶栏切换、管理视图与 Esc/× 关闭；页面渲染为受限沙箱 iframe（不授予顶层导航），并对无边框桌面壳的窗口拖拽区做了 no-drag 豁免。
- 纯 JS、零构建、零运行时依赖。

## 限制 / Limitations

- 目标站点若发送 `X-Frame-Options` / CSP `frame-ancestors` 拒绝内嵌，则无法在 iframe 中显示——内网自有应用一般不受限。
- 列表按 Harness home 保存（每产品安装一份），不做多用户区分。

## License

MIT
