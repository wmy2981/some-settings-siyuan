# AGENTS.md

思源笔记插件 `some-settings-siyuan` 的开发规范。给在此仓库里工作的 AI / 协作者看。

---

## 1. 这个项目是什么

一个**「可独立启停的设置项集合」**插件：每个设置项都有自己的文件夹、自己的 JSON 配置文件，
可以单独启用、禁用、隐藏、重置，**不需要改一行源码**。

* 最低思源版本 `3.8.6-alpha.4`；前端 `all`，后端 `all`
* 名称：`plugin.json` 的 `name` 必须与仓库名一致（`some-settings-siyuan`）
* 当前阶段：机制层 + 22 个真实功能已交付，功能开发按同一套约定继续往下加

核心机制：**`feature-control.json` 里的四态决定「读不读磁盘上的配置」和「显不显示设置行」；
功能跑不跑由它自己那个默认关闭的开关决定**（见 §3）。`src/features/` 下每个文件夹就是一个功能单元。

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
│   ├── frontend.ts           「桌面端 / 移动端」的唯一判定入口
│   ├── registry.ts           唯一静态导入全部功能的文件
│   ├── config.ts             每个功能的 JSON 读 / 写（含写后读回校验）/ 重置
│   ├── style.ts              可撤销的 CSS 注入
│   ├── ui.ts                 原生风格 UI 基元 + PANEL_CSS
│   ├── error.ts              错误隔离与统一上报
│   ├── setting-dialog.ts     单列设置面板（取消 / 保存）
│   └── bootstrap.ts          按四态 + 各功能开关装载并挂载
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
* `npm run check` 会在构建前拦住：清单缺条目 / 多条目 / 状态越界 / 文件夹名与 id 不一致 / settings key 重复 / i18n 缺 key / 用了已移除的 `action` 字段 / 功能没有默认关闭的开关。

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

* **单列纵向列表，只有一层**：分类（功能 / 界面 / 开发）是**小节标题**，不是独立页签；
  小节标题之下直接是设置行，**任何形式的嵌套分组都不允许**。
  `SettingField` 因此也没有 `group` 型 —— 从类型上就写不出层级。
* 每个功能的名称与说明渲染成一行（`.some-settings-panel__sub`），它就是一行
  `b3-label config-item`，位置在分类标题之后、该功能的参数行之前。
  **功能自己那个默认关闭的开关就放在这一行**，不再单独占一行；功能还有参数时，
  参数行排在它下面。
  拿 selector 当开关的功能（声明了 `isEnabled`）同理：那个 select 也放这一行，
  **不再另起一行显示**——它就是开关，不是参数。
* 面板里的文案只有两种角色，字重也只有两档：
  **功能名（父项）统一加粗**，**它下面的子设置项与说明一律常规字重**
  （说明再用 `.b3-label__text` 更小更淡）。
  只有 `.some-settings-panel__sub > .config-item__main` 是粗体；
  不要再给某一类行单独调字重或字号——之前把全部 `.config-item__main` 都加粗，
  子设置项跟父项一样粗，层级就看不出来了。
* 界面自带动作区，**面板底栏只有「取消 / 保存」两个按钮**，不额外加任何底栏按钮。
  ⚠️ 宿主的 `Dialog` **不会自动生成动作区**，动作区必须写在自己的 `content` 里。
* 优先使用思源原生类名，保证与内置设置面板一致：

  | 用途        | 类名                                                                             |
  | ----------- | -------------------------------------------------------------------------------- |
  | 分类        | `config-group` / `config-title` / `config-items`                                 |
  | 行 / 文案   | `b3-label config-item` / `config-item__main` / `b3-label__text`                  |
  | 功能名标题  | `b3-label config-item some-settings-panel__sub`                                  |
  | 开关        | `b3-switch fn__flex-center`                                                      |
  | 下拉        | `b3-select fn__flex-center fn__size200`                                          |
  | 输入        | `b3-text-field fn__flex-center fn__size200`                                      |
  | 数字 + 单位 | `fn__size200 fn__flex-center fn__flex config-item__number` + `config-item__unit` |
  | 按钮        | `b3-button b3-button--outline fn__flex-center fn__size200`                       |

* 设置字段支持 `switch` / `text` / `number` / `select` 四种取值控件，外加一种 `button` 动作行：
  * `select` 的 `options` 可以换成 `optionsProvider: () => SettingOption[]`，
    在面板每次打开时现算候选集（笔记本、插件列表这类只有运行时才知道的数据）；
    走这条路时 `core/config.ts` 不做白名单校验，失效的值由功能自己兜底
  * `button`（`label` + `onClick`）**只用于「点击即打开某个窗口」这类没有可持久化取值的入口**，
    不进草稿、不受「取消 / 保存」影响，只读 / 发布模式下禁用。
    它不是用来放普通操作按钮的 —— 面板底栏仍然只有取消 / 保存
* **每个功能的第一个设置行必须是默认关闭的开关**（或声明 `isEnabled`），见 §3。
* **间距与分割线全部交给内核**：行内边距 `16px 24px`、行与行之间的 `1px` 分割线都来自
  `.b3-label`，插件不做覆盖。`PANEL_CSS` 只碰四件事：分类标题的间距、
  去掉 `.config-items` 的灰底大圆角、文案的两档字重、窄屏下功能行不折行。
* 面板每次打开都会**重写**自己那份 `<style>` 的内容（见 §8 第 6 条），
  所以改 `PANEL_CSS` 后重载插件就能生效，不必整页刷新。
* 一个分类的行是跨功能拼出来的，`:last-child` 看不见真正意义上的最后一行，
  所以由 `setting-dialog.ts` 的 `markLastRow()` 给最后一行加 `config-item--last-visible`，
  去掉它多余的下分割线。
* 窄屏（≤750px，与内核同一断点）由 `PANEL_CSS` 的媒体查询处理：内边距收窄；
  折行本身由内核的 `.config-item` 规则完成，插件不再自己折。它靠 `.some-settings-dialog`
  类挂作用域，只在弹窗存在期间生效。
* **单位标签必须 `white-space: nowrap`**，否则窄屏下会被压成一列一个字。
  数字行的 `unit` 与其它文案一样按 **i18n key** 解析：`"px"` / `"ms"` / `"%"` / `"vh"`
  查不到就原样返回，而 `"kernelAutoReconnect.times"` 这种才会翻成「次」/ "times"。
  `setting-dialog.ts` 里**不能**把 `unit` 当字面量直接拼进 HTML——踩过一次，面板上真的
  显示了那串 key。

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
7. 每个功能都要在三种状态下自测：`state: 1`（正常）、`state: 0`（不加载不显示）、
   `state: 2`（加载但不显示）；开关本身也要测「开着 → 关掉」是否真的把样式、监听、
   注入的节点全部撤干净。

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

6. **注入的 `<style>` 必须每次重写内容，不能在元素已存在时直接 return。**
   「禁用 / 启用插件」和「重载插件」都**不会重载页面**，`<head>` 里的 `<style>` 会留下来，
   于是新代码配上一份旧样式表。现象极具迷惑性：**JS 改的 DOM 生效了（比如开关换了位置），
   但 CSS 改的东西（字重、间距）纹丝不动，而且重载插件多少次都没用，只有整页刷新才恢复。**
   `core/ui.ts` 的 `ensurePanelCss()` 现在每次都比对并重写；`core/style.ts` 的 `addStyle()`
   本来就是这样，所以只有面板中过一次招。**排查 UI 改动"没生效"时先怀疑这一条。**

7. **`getAllEditor()` 返回的 `Protyle` 是外壳，真正的编辑器在 `protyle.protyle`（`IProtyle`）。**
   外壳上**没有** `element` / `block` / `disabled`，取 `editor.element` 会得到 `undefined`
   （`.find()` 直接失配）；`IProtyle` 才有 `element` / `block.rootID` / `disabled`。
   另外 `.protyle-wysiwyg` 容器**没有** `data-node-id`（内核注释里写明），
   想从 DOM 取文档 id 要用 `.protyle-background[data-node-id]` / `.protyle-title[data-node-id]`。
   `first-doc-icon` 就是因为这两处都取了空值而"完全不生效"，且只留下一条日志。

8. **用自定义菜单顶替原生 `<select>` 时，必须把随后的 `click` 也吞掉。**
   内核的全局 click 处理器见到"点在菜单外面"就 `window.siyuan.menus.menu.remove()`，
   于是菜单「闪一下就消失」；而手指在控件上滑动不会产生 click，现象就变成
   **"只有滑动能用、点按不行"**。捕获阶段 `preventDefault()` + `stopPropagation()`
   即可同时挡住浏览器默认弹层与这次 click。

9. **两层对齐（透明输入框 + 底层高亮层）时，主题自带的高亮样式必须压掉。**
   highlight.js 的主题里写着 `pre code.hljs { padding: 1em }`，
   它的特异性比"自己写的 `.__highlight code`"更高，会把高亮层整体错开 1em，
   主题的 `background` 也会盖住输入框 —— 现象是**编辑框"完全没法用"**。
   压掉它要么用更深的特异性（`.__highlight > code.hljs`），要么 `!important`。
   同理，输入框的 `color` / `background-color` **只能在变透明之前抄一次**：
   生效后它俩算出来是透明的，每帧再抄一次会让高亮层的字也一起消失。

10. **页面上的图标容器可能就是那个 `<svg>` 本身。**
    移动端页签在没有图标时渲染的是 `<svg class="mobile-tabs__item-icon">` —— 容器与 svg 是
    同一个元素。往 `<svg>` 上写 `textContent` 只会插一个文本节点，而 SVG 不渲染裸文本，
    页签于是变成**一片空白**。要换 emoji 就把整个元素换成内核自己给 emoji 用的
    `<span class="mobile-tabs__item-icon">📄</span>`。
    注意 `element.querySelector("svg use")` **能**命中这个元素自己内部的那个 `<use>`
    （祖先组合器可以匹配上下文元素本身），所以"是不是默认图标"的判断照样通过、
    代码真的会执行下去 —— 判断通过不等于写法正确。
    同理，自己改 DOM 的 `MutationObserver` 要在写入前 `disconnect()`，否则每一次写入都会
    再触发自己，变成每帧一次的空转。

11. **`flex-wrap` 的折行判定发生在收缩之前。**
    开了一行 `flex-wrap: wrap` 之后，浏览器先用各项的**基准尺寸**（`flex-basis`）判断放不放得下，
    放不下就换行，换行之后没有收缩的机会。所以「标题 `flex: 1 1 auto`、控件留在同行」这种做法
    在标题一长（或右边是下拉这种更宽的控件）时就会失效，控件被顶到第二行。
    功能行要用 `flex: 1 1 0` 让基准取 0，再由 `flex-grow` 分配剩余宽度。
    另外 **`:first-child`、`:not(.x)` 里的选择器都算特异性**：
    `div.config-item > .config-item__main:first-child` 是 (0,4,1)，比只写 4 个类名的
    (0,4,0) 高，想覆盖它必须再补一级，光靠"写在后面"是没用的。

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
