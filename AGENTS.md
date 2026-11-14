# AGENTS.md

思源笔记插件 `some-settings-siyuan` 的开发规范。踩过的坑见 [development.md](./docs/development.md)，
设置面板见 [setting-panel.md](./docs/setting-panel.md)。

---

## 1. 项目性质

一个**「可独立启停的设置项集合」**插件：每个设置项有自己的文件夹、自己的 JSON 配置文件，
可以单独启用、禁用或重置，**不需要改一行源码**。

---

## 2. 边界

* `src/core/` 只放机制，不放业务逻辑；`src/features/<id>/` 一个功能一个目录，`index.ts` 只做声明。
* 功能之间**零 import**，只依赖 `core/`。
* 不要直接改 `src/` 之外的东西来实现功能；功能要不要交出、支持哪些思源版本，全部写在各自的
  `index.ts` 声明里，没有第二份清单。

---

## 3. 声明与开关

`index.ts` 的顶层 `enabled` 只决定**这个功能还要不要**（不加载配置、不进面板、不挂载）；
功能**跑不跑**由它自己的开关决定。这两件事必须分开，不要用 `enabled` 表达「用户开没开」。

| 声明             | 加载已有配置 | 面板显示 | 允许运行                   |
| ---------------- | ------------ | -------- | -------------------------- |
| `enabled: true`  | 是           | 是       | 是，再受功能自己的开关约束 |
| `enabled: false` | 否           | 否       | 否                         |

* `enabled` 必须显式写 `true` / `false`，缺失由 `npm run check` 拦下。
* 每个功能的第一个设置项是**默认关闭**的开关（`key: "enabled"`、`default: false`），后面的控件才是参数。
  例外：需求本身就是「用一个 selector 当开关」的功能不额外加开关，改声明 `isEnabled(config)` 谓词。
* 保存开关后立即挂载或**完整卸载**该功能，不需要重载插件。
* 上游自己实现了某个能力后，功能必须能退场：声明 `maxAppVersion: "<前一个思源版本>"`，
  宿主版本超过它就不再加载、不显示、不挂载。`minAppVersion` / `maxAppVersion` 都是**闭区间**，
  不写表示该侧不限；版本号按 `alpha < beta < rc < 正式版` 比较。

**推论（很重要）**：功能关着时根本不会被挂载，所以不能用 `addTopBar` / `addDock` / `addTab` /
`addCommand` 这类必须在 onload 同步注册的 API；真要用就把 `mount` 写成无条件执行、内部按开关收放。
`addProtyleSlash` 是例外：宿主每次打开斜杠菜单才读数组，mount 后动态增删安全。

**新增功能**：建 `src/features/<id>/`（id 只用小写字母、数字、连字符）→ `defineFeature` 里
`name` / `description` 是 **i18n key** 而不是字面量，分类取本文件与 `core/types.ts` 列出的原生功能区，
`enabled` 按是否需要交出写 `true`，需要限定思源版本时补 `minAppVersion` / `maxAppVersion` →
在 `registry.ts` 登记（数组顺序即面板顺序）→ 两份 i18n 补齐 key → 关键动作埋足日志（见第 5 节）→
`npm run check && npm run typecheck && npm run lint`。

---

## 4. 配置持久化

* 每个功能一个文件：`data/storage/petal/some-settings-siyuan/feature-<id>`。
* **只能用** `plugin.loadData` / `saveData` / `removeData`。**禁止 `fs`、`require("electron")`
  或任何 Node API** —— 会破坏同步并可能损坏云数据。
* 面板**改完即落盘**：控件一变就写该功能自己的配置文件，没有草稿、没有「保存 / 取消」按钮。
  文本 / 数字框按静默期合并写盘（失焦立即写，关面板时补写），与磁盘相同的值不重复写盘。
* 写盘后必须**读回校验**：宿主的 `saveData` 在文件真正落盘前就可能 resolve，而且从不检查
  `response.code`。校验失败 / 写盘失败**不允许静默通过**：内存态退回改动之前，面板把控件改回
  磁盘上的值并让用户看见问题。

---

## 5. 功能与核心的接口

功能**只能**通过 `FeatureHost`（`core/types.ts`）访问平台，不要直接 `import {Dialog, Menu, ...}
from "siyuan"` 去注册 UI；需要新的平台能力时先加进 `FeatureHost`。

* **插件本体不在顶栏 / 状态栏 / 停靠栏注册任何入口**；设置面板的唯一入口是覆盖 `Plugin.openSetting()`。
* 所以**只有单个功能**才允许注册自己的按钮 / 命令 / 停靠栏，且必须可撤销。
* 所有注册都要有配对的清理，卸载逻辑必须幂等。
* 日志一律走 `core/log.ts`：功能里用 `host.log` 的 `info` / `warn` / `error`，动作行用
  `logInfo` / `logWarn` / `logError`（作用域写功能 id）。头部自动带
  `[some-settings-siyuan__<功能 id>]`，详细日志默认关闭，开启入口是「插件自身」页签里的
  「详细日志输出」。**不要直接 `console.*`**（`mobile-console-log` 抓取 `console` 的包装除外）。
* **新功能必须埋足日志**：挂载与卸载、配置变化、接管的对象（DOM / 事件 / 请求）、关键分支与
  状态变化、失败路径都要有 INFO / WARN / ERROR，只记失败路径不算够。详细日志默认关闭，
  多记不打扰用户，缺日志才是问题；高频路径（每次重绘、每次对账）只在结果真的变化时记一行，
  不要刷屏。

---

## 6. 真实功能开发时必须遵守

1. **原生优先**：只用官方插件 API、事件总线、内核 API、思源样式类。
2. **不改核心 DOM**：不改写思源原生 DOM 结构，优先 CSS、事件监听、官方扩展点。
3. **可回退**：任何功能异常都被 `core/error.ts` 隔离上报，绝不冒泡到插件入口；
   错误处理必须保证 UI 状态与磁盘状态一致（保存失败要回滚控件）。
4. **默认关闭**：未明确要求的其它默认值一律取「关闭」或「跟随思源自身设置」。
5. **移动端**：`getFrontend()` 返回 `mobile` / `browser-mobile` 时弹窗 92vw；
   不要依赖只有桌面端存在的 DOM。

---

## 7. 命令与发布

`npm run dev | build | check | typecheck | lint | format | format:check`。`assets/` 里的图标与预览图
由 `scripts/` 生成，不要手改。

`npm test` 走两个 project（`vm` / `forks`，见 `vitest.config.mts`），纯逻辑测试的文件级环境声明、
`vmThreads` 缺的 Web API 补齐、`closeOpenSettings()` 收尾都不能删——删了要么变慢十倍，要么留下
退出码不为 0 的定时器（见 development.md 的「构建与测试」）。

发布：本地提交完成 → `plugin.json` 与 `package.json` 的 `version` **同步**提升 → `git push origin main`。
**非用户要求禁止自行发布新版本、修改版本号。**

---

## 8. 提交与文档

* **Conventional Commits**，一个小改动一个 commit，提交信息用英文说清「改了什么」。
* 用户可见的文案必须**中英双语**同时写进两份 i18n。
* `README.md` / `README.zh-CN.md` 是集市展示页，改动用户可见行为时要同步更新，两份内容必须一致。
* **`dev-refs/` 是本地唯一权威开发参考资料，不得纳入版本管理，也不得在任何文档、注释、提交信息里引用或提及。**
* 非用户明确要求，**禁止自行进行端到端测试或操作用户的思源工作空间**。
