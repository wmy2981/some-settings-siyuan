# AGENTS.md

思源笔记插件 `some-settings-siyuan` 的开发规范。

---

## 1. 这个项目是什么

一个**「可独立启停的设置项集合」**插件：每个设置项都有自己的文件夹、自己的 JSON 配置文件，
可以单独启用、禁用、隐藏、重置，**不需要改一行源码**。

---

## 2. 目录与职责

```
feature-control.json          唯一调控入口：每个功能 id 一个四态开关
plugin.json  package.json     版本号两处必须一致
src/
├── index.ts                  插件入口
├── index.scss                全局样式入口
├── declarations.d.ts
├── i18n/{en,zh-CN}.json      界面文案
├── core/                     机制层：这里不放任何业务功能
│   ├── types.ts              FeatureDefinition / SettingField / FeatureHost
│   ├── control.ts            读 feature-control.json，归一化四态
│   ├── frontend.ts           「桌面端 / 移动端」的唯一判定入口
│   ├── registry.ts           唯一静态导入全部功能的文件
│   ├── config.ts             每个功能的 JSON 读 / 写（含写后读回校验）/ 重置
│   ├── style.ts              可撤销的 CSS 注入
│   ├── ui.ts                 原生风格 UI 基元 + PANEL_CSS
│   ├── error.ts              错误隔离与统一上报
│   ├── setting-dialog.ts     单列设置面板
│   └── bootstrap.ts          按四态 + 各功能开关装载并挂载
└── features/<id>/            一个功能一个子文件夹
    ├── index.ts              只做声明：defineFeature({...})
    └── <impl>.ts             具体实现
assets/                       发行视觉素材
scripts/                      开发脚本
```

**硬性边界**

* `src/core/` 只放机制，不放业务逻辑。
* 不要直接改 `src/` 之外的东西来实现功能；`feature-control.json` 是数据配置，不是代码。

---

## 3. 四态调控：本项目的核心约定

`feature-control.json`：

```jsonc
{
  "version": 1,
  "features": {
    "modal-blur": { "state": 1 },
    "code-block-lang-empty": { "state": 1 },
    "mobile-console-log": { "state": 0 }
  }
}
```

| `state` | 加载已有配置 | 前端显示设置行 | 允许运行 |
| ------- | ------------ | -------------- | -------- |
| `0`     | 否           | 否             | 否       |
| `1`     | 是           | 是             | 是       |
| `2`     | 是           | 否             | 是       |
| `3`     | 否           | 是             | 是       |

* 缺失 key、非法值、未知 id 在运行期一律按 `0` 处理，并只告警一次。
* **`state` 约束的是「读取」，不是「写入」**：`0` / `3` 的功能不读盘，但用户在面板里显式保存的值仍会写进它自己的 JSON。

### 清单管「能不能」，开关管「做不做」

这两件事**必须分开**，不要用 `state` 去表达「功能开没开」：

* `feature-control.json` 只决定**加不加载已有配置**、**设置面板显不显示**这个功能；
* 功能**实际跑不跑**由它自己的控件决定 —— 面板里每个功能的第一行都是一个**默认关闭**的
  开关（`key: "enabled"`、`default: false`），后面的下拉 / 输入框才是它的参数。

因此：新装插件时所有功能都是关的；用户保存开关后 `FeatureManager` 会立刻挂载或
**完整卸载**该功能（`bootstrap.ts` 的 `syncMount`），不需要重载插件。

两个例外：需求本身就是「用一个 selector 当开关」的功能（`inline-code-copy`、
`mobile-longpress-menu-label`）不额外加开关，改为声明 `isEnabled(config)` 谓词把
那个 selector 的「禁用」选项映射成「不运行」。`state: 2` 的功能面板里没有开关可点，
按「已允许运行」处理。

**推论（很重要）**：功能关着的时候**根本不会被挂载**，所以实现里不能用
`addTopBar` / `addDock` / `addTab` / `addCommand` 这类必须在 onload 同步注册的 API。
真需要的话，把 `mount` 写成无条件执行、内部自己按开关收放。

**新增一个功能 = 7 步**（顺序不能省）：

1. 新建 `src/features/<id>/`（`<id>` 只允许小写字母、数字、连字符）
2. 写 `index.ts`，默认导出 `defineFeature({id, category, name, description, settings, mount})`；
   `name` / `description` 是 **i18n key**，不是字面量；`settings` 里第一个必须是
   默认关闭的开关（或声明 `isEnabled`）
3. 在 `src/core/registry.ts` 登记：一行 import + 一个数组条目（顺序即面板里的显示顺序）
4. 在 `feature-control.json` 里补上该 id 并选一个 state
5. 把用到的所有 i18n key 补进 `src/i18n/en.json` 与 `src/i18n/zh-CN.json`
6. `npm run check && npm run typecheck && npm run lint`
7. 只通过 `FeatureHost` 访问平台能力（见 §5）

---

## 4. 配置持久化

* 每个功能一个文件：`data/storage/petal/some-settings-siyuan/feature-<id>`
* **只能用** `plugin.loadData` / `saveData` / `removeData`。
  **禁止 `fs`、`require("electron")` 或任何 Node API** —— 会破坏同步并可能损坏云数据。
* 保存流程：面板改的是**草稿**，点「保存」才写盘，点「取消」丢弃，有未保存改动时先确认。
* `ConfigStore.saveMany()` 会在**写完立刻读回校验**：宿主的 `saveData` 在文件真正落盘前就可能 resolve，
  而且从不检查 `response.code`。读回不一致会抛错，面板保持打开并弹出具体字段差异。
* 校验失败 / 写盘失败时**不允许静默通过**，必须让用户看见问题。

---

## 5. 功能与核心的接口：`FeatureHost`

功能**只能**通过宿主对象访问平台，不要直接 `import {Dialog, Menu, ...} from "siyuan"` 去注册 UI：

```ts
setConfig(patch)            落盘并通知功能自身
onConfigChange(listener)    订阅本功能配置变化（面板保存后触发），随卸载自动退订
addStyle(css)               注入/更新本功能的一段 CSS，返回撤销函数
addTopBar / addStatusBar    顶栏 / 状态栏条目（必须在 onload 阶段同步调用）
addCommand                 插件命令
addDock / addTab            停靠栏 / 页签
addIcons                    注册内联 SVG symbol
addEventBus(type, listener) 事件总线，卸载时自动 off
showMessage(text)           提示
log(...)                    带功能前缀的控制台日志
```

约定：

* **插件本体不在顶栏/状态栏/停靠栏注册任何入口**。设置面板的唯一入口是思源内置入口：
  它靠覆盖 `Plugin.openSetting()` 生效（宿主用 `hasPluginSetting()` 判断是否覆盖）。
* 所以**只有单个功能**才允许注册自己的按钮/命令/停靠栏，且必须可撤销。
* 所有注册都要有配对的清理，卸载逻辑必须幂等。

---

## 6. 设置面板规范

[设置面板规范文档](./docs/setting-panel.md)

---

## 7. 真实功能开发时必须遵守

1. **原生优先**：只用官方插件 API、事件总线、内核 API、思源样式类。
2. **不改核心 DOM**：不改写思源原生 DOM 结构，优先 CSS、事件监听、官方扩展点。
3. **模块隔离**：功能之间零 import，只依赖 `core/`。
4. **可回退**：任何功能异常都被 `core/error.ts` 隔离上报，绝不冒泡到插件入口；
   错误处理必须保证 UI 状态与磁盘状态一致（保存失败要回滚控件）。
5. **默认关闭**：每个功能都必须有一个默认关闭的开关（或 `isEnabled` 谓词），
   未明确要求的其它默认值一律取「关闭」或「跟随思源自身设置」。
6. **移动端**：`getFrontend()` 返回 `mobile` / `browser-mobile` 时弹窗 92vw；
   不要依赖只有桌面端存在的 DOM。

---

## 8. ⚠️ 已踩过的坑和开发经验

[ExperienceDoc](./docs/experience.md)

---

## 9. 命令与发布

```bash
npm install
npm run dev            # webpack watch
npm run build          # check + 生产构建 + package.zip
npm run check          # feature-control 清单与注册表一致性
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # dprint fmt
npm run format:check   # dprint check
node scripts/render-icon.mjs      # assets/icon.svg -> icon.png
node scripts/render-preview.mjs   # assets/preview.html -> preview.png
```

资源文件由脚本生成

发布流程：

1. 本地提交完成，`plugin.json` 与 `package.json` 的 `version` **同步**提升
2. `git push origin main`
   **非用户要求禁止自行发布新版本**

---

## 10. 提交与文档

* **Conventional Commits**，分点提交，一个小改动一个 commit。
* 提交信息用英文，说清「改了什么」。
* 用户可见的文案必须**中英双语**同时写进两份 i18n。
* `README.md` / `README.zh-CN.md` 是集市展示页，改动用户可见行为时要同步更新。
* **`dev-refs/` 是本地唯一权威开发参考资料，不得纳入版本管理，也不得在任何文档、注释、提交信息里引用或提及。**
