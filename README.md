# dsh-miniapps

为 DeepSeek Harness 增加**可配置的小应用（mini app）标签页**：每个配置的内部 Web 应用出现在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 工作台的 `+` 菜单里，点击后在独立分栏中以沙箱内嵌页方式打开。

Configurable mini-app tabs for the DeepSeek Harness workbench sidebar: each configured internal web app appears in the better-sidebar `+` menu and opens as a sandboxed embedded page in its own pane.

## 安装 / Install

作为 dsh bundle 分发（`dsh.bundle` + `cordis.patch.yml`）。产品组合按提交钉定并将其加入 profile 的 `dsh.profile.bundles`；独立安装可用：

```sh
dsh plugin --profile <name> add dsh-miniapps
```

## 配置 / Configuration

自带 patch 挂载 `miniapps` 行；`apps` 为小应用列表，后续 profile patch 层可整体覆盖：

```yaml
- id: miniapps
  config:
    apps:
      - id: mic-ai-agent        # kebab-case 唯一 id
        name: MIC AI代理         # 标签页标题
        url: http://10.110.5.239:9098
        # icon: https://.../icon.png   # 可选，16px 图标
```

配置错误（非法 id、重复 id、非 http(s) URL）在插件加载时立即失败，不会静默出空标签。

## 机制 / How it works

- **Host 半**（`lib/index.js`，注入 `webServer`）：加载时校验 `apps`，经 `GET /plugins/miniapps/config` 提供给浏览器半——页面看到的列表以该路由为唯一权威。
- **浏览器半**（`lib/client.js`，注入 `betterSidebar`）：读取列表，对每个应用调用 `ctx.betterSidebar.registerTab`（`single: true` 去重；`order` 从 120 起排在内置 tab 之后），页面渲染为受限沙箱 iframe（`allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals`，不授予顶层导航）。
- 纯 JS、零构建、零运行时依赖；卸载/HMR 时注册项经 disposer 全部撤销。

## 限制 / Limitations

- 目标站点若发送 `X-Frame-Options` / CSP `frame-ancestors` 拒绝内嵌，则页面无法在 iframe 中显示——内网自有应用一般不受限。
- 列表当前来自组合配置（产品预置 + profile patch 覆盖）；不含最终用户界面内编辑。

## License

MIT
