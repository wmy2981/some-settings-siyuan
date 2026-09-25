[English](README.md)

# 一些设置 / Some Settings

> 一个思源笔记插件：提供一批**可独立启停**的桌面端与移动端增强功能。

每个设置项都有自己的文件夹和 JSON 配置文件，可以单独启用、禁用、隐藏、重置，
不需要改动任何源代码。

* 最低思源版本：`3.8.6-alpha.4`
* 前端环境：桌面端、移动端、桌面窗口、浏览器
* 后端环境：全部

## 核心机制

仓库根目录的一份清单决定「什么会加载」「什么会显示」：

```jsonc
// feature-control.json
{
  "version": 1,
  "features": {
    "function-demo": { "state": 1 },
    "ui-demo": { "state": 1 },
    "dev-demo": { "state": 0 }
  }
}
```

| `state` | 加载已有配置 | 前端显示可设置 | 运行功能 |
| ------- | ------------ | -------------- | -------- |
| `0`     | 否           | 否             | 否       |
| `1`     | 是           | 是             | 是       |
| `2`     | 是           | 否             | 是       |
| `3`     | 否           | 是             | 是       |

四种状态都有明确用途：

* **`0`** —— 彻底下线一个过时功能，代码仍然留在仓库里
* **`1`** —— 正常启用、完整可用
* **`2`** —— 老用户照旧使用，但前端不再显示设置项
* **`3`** —— 只保留设置项供查看/修改，不真正运行

运行期遇到缺失的 key、越界的取值或未知 id 一律按 `0` 处理；
而 `npm run check` 会在构建前拦住清单与代码不一致的情况。

## 功能清单

本版本交付的是插件骨架 + 每个分类一个示例项，用来端到端验证整条链路。
后续功能按文件夹逐个添加。

| 功能            | 分类 | 首次运行状态 | 验证了什么                                                        |
| --------------- | ---- | ------------ | ----------------------------------------------------------------- |
| `function-demo` | 功能 | `1`          | 顶栏按钮 + 插件命令 + `switch` / `text` / `number` 三种设置项     |
| `ui-demo`       | 界面 | `1`          | 可回退的命名空间 CSS 注入 + `select` 设置项                       |
| `dev-demo`      | 开发 | `0`          | `action` 型设置项、配置导出、注册表诊断，以及 `state: 0` 这条路径 |

## 设置面板

从插件顶栏按钮打开（移动端点图标即可；桌面端同一按钮还带右键菜单入口）。
面板分为 **功能 / 界面 / 开发** 三类，使用思源自己的类名
（`b3-switch`、`b3-select`、`b3-text-field`、`b3-button`、`config-item`、`config-title`、`config-items`），
尺寸与间距和内置设置面板保持一致。

改动即时保存。与内置 `Setting` 组件的唯一有意差异是：本面板没有全局「保存」按钮——
因为每个设置项都必须能单独重置，所以控件变更即落盘。用「重置本功能」删除该功能的 JSON 并恢复默认值。

## 目录结构

```text
some-settings-siyuan/
├── feature-control.json        # 唯一调控入口：每个功能 id 的四态开关
├── plugin.json                 # 集市清单
├── src/
│   ├── index.ts                # 插件入口：onload / onLayoutReady / onunload / uninstall
│   ├── i18n/{en,zh-CN}.json    # 界面文案
│   ├── core/                   # 机制层，这里不放任何业务功能
│   │   ├── types.ts            # FeatureDefinition / SettingField / FeatureHost
│   │   ├── control.ts          # 读取 feature-control.json，归一化四态
│   │   ├── registry.ts         # 唯一静态导入全部功能的文件
│   │   ├── config.ts           # 每个功能的 JSON 读取 / 保存 / 重置
│   │   ├── style.ts            # 可撤销的 CSS 注入
│   │   ├── ui.ts               # 原生风格 UI 基元
│   │   ├── error.ts            # 错误隔离，绝不让单个功能拖垮插件
│   │   ├── setting-dialog.ts   # 三分类设置面板
│   │   └── bootstrap.ts        # 按清单装载并挂载各功能
│   └── features/
│       ├── function-demo/{index.ts,demo.ts}
│       ├── ui-demo/{index.ts,style.ts}
│       └── dev-demo/{index.ts,dev.ts}
├── assets/                     # icon.svg/icon.png、preview.html/preview.png
└── scripts/
    ├── check-features.mjs      # 清单与注册表一致性校验
    ├── render-icon.mjs         # icon.svg -> 160x160 icon.png（≤ 64 KiB）
    ├── render-preview.mjs      # preview.html -> 1024x768 preview.png（≤ 512 KiB）
    └── release-notes.mjs       # Conventional Commits -> 发行说明
```

运行期数据落在工作空间的
`data/storage/petal/some-settings-siyuan/feature-<id>.json`。
所有读写都走 `plugin.loadData` / `saveData` / `removeData`，插件不会直接调用 `fs` 或任何 Node API。

## 新增一个功能

1. 新建 `src/features/<id>/`（`<id>` 只允许小写字母、数字与连字符）。
2. 添加 `index.ts`，导出 `defineFeature({id, category, name, description, settings, mount})`。
   `name` 与 `description` 是 i18n key，不是字面量。实现代码放同目录的另一个文件。
3. 在 `src/core/registry.ts` 里登记（一行 import 加一个数组条目）。
4. 在 `feature-control.json` 里补上该 id 并选择状态。
5. 把用到的所有 i18n key 同时补进 `src/i18n/en.json` 与 `src/i18n/zh-CN.json`。
6. 跑 `npm run check`、`npm run typecheck`、`npm run lint`。
7. 访问平台能力一律通过 `FeatureHost`（`addTopBar`、`addCommand`、`addEventBus`、`addStyle` 等）。
   功能之间不得互相 import；共用逻辑放 `src/core/`。

## 开发

```bash
npm install
npm run dev          # webpack watch，产出根目录的 index.js / index.css 并复制 i18n/
npm run check        # feature-control 清单一致性
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format:check # dprint check
npm run build        # check + 生产构建 + package.zip
```

实时开发时，把这个目录放到思源能加载的位置（例如 `<工作空间>/data/plugins/`），
执行 `npm run dev`，然后在「设置 → 集市 → 已下载」里启用插件。
`npm run build` 产出可直接上传集市的 `package.zip`，内部是扁平结构
（`index.js`、`index.css`、`plugin.json`、`i18n/`、`icon.png`、`preview.png`、`README*.md`）。

## 设计原则

* **原生优先** —— 只用官方插件 API、事件总线、内核 API 与思源自带样式类。
* **不改核心 DOM** —— 优先 CSS、事件监听与官方扩展点。
* **模块隔离** —— 一个功能一个文件夹，功能之间零 import。
* **可回退** —— 任何功能异常都被捕获上报，绝不向外冒泡；卸载逻辑幂等。
* **默认关闭** —— 未明确指定默认值的地方一律关闭或跟随思源自身设置。

## 已知限制

* 关闭功能**不会**把它的代码从产物里移除。门控只在运行时生效，这样改
  `feature-control.json` 永远不需要改源码或条件导入；代价是包体大小换「改一个数据文件即可禁用」。
* 设置面板没有全局「保存」按钮（原因见上）。
* 功能被禁用后再重新启用插件命令需要重载插件：宿主 API 没有单条命令的移除接口，
  命令只随插件一起释放。
* `dev-refs/` 是本地开发参考目录，属于未跟踪内容，刻意不纳入版本管理。

## 许可证

MIT
