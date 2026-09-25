# AGENTS.md

思源笔记插件 `some-settings-siyuan` 的开发规范。给在此仓库里工作的 AI / 协作者看。

---

## 1. 这个项目是什么

一个**「可独立启停的设置项集合」**插件：每个设置项都有自己的文件夹、自己的 JSON 配置文件，
可以单独启用、禁用、隐藏、重置，**不需要改一行源码**。

* 最低思源版本 `3.8.6-alpha.4`；前端 `all`，后端 `all`
* 名称：`plugin.json` 的 `name` 必须与仓库名一致（`some-settings-siyuan`）
* 当前阶段：机制层已完成并验证通过，接下来进入真实业务功能开发

核心机制一句话：**`feature-control.json` 里的四态决定「读不读磁盘上的配置」和「显不显示设置行」**，
而 `src/features/` 下每个文件夹就是一个功能单元。

---

## 2. 目录与职责（不要越界）

```
feature-control.json          唯一调控入口：每个功能 id 一个四态开关
plugin.json  package.json     版本号两处必须一致（CD 会校验）
webpack.config.js  tsconfig.json  eslint.config.mjs  dprint.json
src/
├── index.ts                  插件入口：onload / onunload / uninstall / openSetting
├── index.scss                全局样式入口（当前为空，仅为产出 index.css）
├── declarations.d.ts
├── i18n/{en,zh-CN}.json      界面文案（必须双语齐全）
├── core/                     机制层：这里不放任何业务功能
│   ├── types.ts              FeatureDefinition / SettingField / FeatureHost
│   ├── control.ts            读 feature-control.json，归一化四态
│   ├── registry.ts           唯一静态导入全部功能的文件
│   ├── config.ts             每个功能的 JSON 读 / 写（含写后读回校验）/ 重置
│   ├── style.ts              可撤销的 CSS 注入
│   ├── ui.ts                 原生风格 UI 基元 + PANEL_CSS
│   ├── error.ts              错误隔离与统一上报
│   ├── setting-dialog.ts     单列设置面板（取消 / 保存）
│   └── bootstrap.ts          按四态装载并挂载各功能
└── features/<id>/            一个功能一个子文件夹
    ├── index.ts              只做声明：defineFeature({...})
    └── <impl>.ts             具体实现
assets/                       icon.svg/icon.png、preview.html/preview.png
scripts/                      check-features / render-icon / render-preview / release-notes
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
    "function-demo": { "state": 1 },
    "ui-demo": { "state": 1 },
    "dev-demo": { "state": 0 }
  }
}
```

| `state` | 加载已有配置 | 前端显示设置行 | 运行功能 |
| ------- | ------------ | -------------- | -------- |
| `0`     | 否           | 否             | 否       |
| `1`     | 是           | 是             | 是       |
| `2`     | 是           | 否             | 是       |
| `3`     | 否           | 是             | 是       |

* 缺失 key、非法值、未知 id 在运行期一律按 `0` 处理，并只告警一次。
* **`state` 约束的是「读取」，不是「写入」**：`0` / `3` 的功能不读盘，但用户在面板里显式保存的值仍会写进它自己的 JSON。
* `npm run check` 会在构建前拦住：清单缺条目 / 多条目 / 状态越界 / 文件夹名与 id 不一致 / settings key 重复 / i18n 缺 key / 用了已移除的 `action` 字段。

**新增一个功能 = 7 步**（顺序不能省）：

1. 新建 `src/features/<id>/`（`<id>` 只允许小写字母、数字、连字符）
2. 写 `index.ts`，默认导出 `defineFeature({id, category, name, description, settings, mount})`；
   `name` / `description` 是 **i18n key**，不是字面量
3. 在 `src/core/registry.ts` 登记：一行 import + 一个数组条目（顺序即面板里的显示顺序）
4. 在 `feature-control.json` 里补上该 id 并选一个 state
5. 把用到的所有 i18n key **同时**补进 `src/i18n/en.json` 与 `src/i18n/zh-CN.json`
6. `npm run check && npm run typecheck && npm run lint`
7. 只通过 `FeatureHost` 访问平台能力（见 §5）

---

## 4. 配置持久化

* 每个功能一个文件：`data/storage/petal/some-settings-siyuan/feature-<id>.json`
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
  **设置 → 集市 → 已下载 →（本插件）→ 设置**。它靠覆盖 `Plugin.openSetting()` 生效
  （宿主用 `hasPluginSetting()` 判断是否覆盖）。
* 所以**只有单个功能**才允许注册自己的按钮/命令/停靠栏，且必须可撤销。
* 所有注册都要有配对的清理，卸载逻辑必须幂等。

---

## 6. 设置面板规范

* **单列纵向列表**，分类（功能 / 界面 / 开发）是**小节标题**，不是独立页签。
* 界面自带动作区，**只有「取消 / 保存」两个按钮**，不额外加任何按钮或底栏。
  ⚠️ 宿主的 `Dialog` **不会自动生成动作区**，动作区必须写在自己的 `content` 里。
* 优先使用思源原生类名，保证与内置设置面板一致：

  | 用途        | 类名                                                                             |
  | ----------- | -------------------------------------------------------------------------------- |
  | 分组        | `config-group` / `config-title` / `config-items`                                 |
  | 行 / 文案   | `b3-label config-item` / `config-item__main` / `b3-label__text`                  |
  | 开关        | `b3-switch fn__flex-center`                                                      |
  | 下拉        | `b3-select fn__flex-center fn__size200`                                          |
  | 输入        | `b3-text-field fn__flex-center fn__size200`                                      |
  | 数字 + 单位 | `fn__size200 fn__flex-center fn__flex config-item__number` + `config-item__unit` |
  | 按钮        | `b3-button b3-button--outline fn__flex-center fn__size200`                       |

* 设置字段只支持 `switch` / `text` / `number` / `select` / `group`。
  **没有按钮型字段** —— 面板里不放自定义按钮。
* 窄屏（≤480px）由 `PANEL_CSS` 的媒体查询处理：内边距收窄、文案与控件改上下两行。
  它靠 `.some-settings-dialog` 类挂作用域，只在弹窗存在期间生效。
* **单位标签必须 `white-space: nowrap`**，否则窄屏下会被压成一列一个字。

---

## 7. 真实功能开发时必须遵守

1. **原生优先**：只用官方插件 API、事件总线、内核 API、思源样式类。
2. **不改核心 DOM**：不改写思源原生 DOM 结构，优先 CSS、事件监听、官方扩展点。
3. **模块隔离**：功能之间零 import，只依赖 `core/`。
4. **可回退**：任何功能异常都被 `core/error.ts` 隔离上报，绝不冒泡到插件入口；
   错误处理必须保证 UI 状态与磁盘状态一致（保存失败要回滚控件）。
5. **默认关闭**：未明确要求的默认值一律取「关闭」或「跟随思源自身设置」。
6. **移动端**：`getFrontend()` 返回 `mobile` / `browser-mobile` 时弹窗 92vw；
   不要依赖只有桌面端存在的 DOM。
7. 每个功能都要在三种状态下自测：`state: 1`（正常）、`state: 0`（不加载不显示）、
   `state: 2`（加载但不显示）。

---

## 8. ⚠️ 已踩过的坑

1. **HTML 属性会把 U+0000 换成 U+FFFD（65533）。**
   控件标识最初用 `\u0000` 拼接并写进 `data-*` 属性，读回时已经变成 `\uFFFD`，
   于是 `parseBindKey` 再也切不开、草稿查不到、id 匹配不上。
   现象是**「改完保存、重开还是默认值」且没有任何报错**。
   现在用可打印的 `::` 分隔（见 `setting-dialog.ts` 的 `BIND_SEPARATOR`）。
   **规则：任何最终写进 HTML 属性的复合字符串都只能用可打印分隔符。**

2. **压缩会把 `console.log` 丢掉。**
   `esbuild` 的 minimizer 会移除 console 调用，导致「出问题但控制台全空」。
   `webpack.config.js` 里已固定 `EsbuildPlugin({drop: [], pure: []})`，**不要删掉这个配置**。

3. **宿主的 `saveData` 在真正落盘前就可能 resolve**，并且不检查 `response.code`。
   所以「没报错」不等于「存住了」。已加写后读回校验 —— 不要移除它。

4. **`Dialog` 不会生成动作区**。少了它，面板里根本没有保存按钮。

5. **不要为了让某个功能跑起来而放宽本文档的限制**（例如跨 feature import、直接改核心 DOM）。
   先讨论，再改规范。

---

## 9. 命令与发布

```bash
npm install
npm run dev            # webpack watch，产出仓库根目录的 index.js / index.css 并复制 i18n/
npm run build          # check + 生产构建 + package.zip
npm run check          # feature-control 清单与注册表一致性
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # dprint fmt
npm run format:check   # dprint check
node scripts/render-icon.mjs      # assets/icon.svg -> icon.png（160×160，≤64 KiB）
node scripts/render-preview.mjs   # assets/preview.html -> preview.png（1024×768，≤512 KiB）
```

资源文件由脚本生成，**不要手改 `icon.png` / `preview.png`**；改 `icon.svg` / `preview.html` 后重跑脚本。

发布流程：

1. 本地提交完成，`plugin.json` 与 `package.json` 的 `version` **同步**提升
2. `git push origin main`

CD（`.github/workflows/cd.yml`）会：校验两个版本号一致 → `npm ci` → `npm run build`
→ 与最新 tag 比较版本：**相同则只上传构建产物，更高则自动打 tag、
用 `scripts/release-notes.mjs` 生成发行说明并创建带 `package.zip` 的 Release**。
（降级会直接失败。）

---

## 10. 提交与文档

* **Conventional Commits**，分点提交，一个小改动一个 commit。
  类型用 `feat` / `fix` / `refactor` / `style` / `docs` / `build` / `chore`。
* 提交信息用英文，说清「改了什么」。
  **踩坑类的修复必须在提交信息里写清根因**
* 用户可见的文案必须**中英双语**同时写进两份 i18n，缺一即构建失败。
* `README.md` / `README.zh-CN.md` 是集市展示页，改动用户可见行为时要同步更新。
* **`dev-refs/` 是本地开发参考资料，不得纳入版本管理，也不得在任何文档、注释、提交信息里引用或提及。**
