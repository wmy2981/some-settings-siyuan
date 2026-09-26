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
    "modal-blur": { "state": 1 },
    "code-block-lang-empty": { "state": 1 },
    "mobile-console-log": { "state": 0 }
  }
}
```

| `state` | 加载已有配置 | 前端显示可设置 | 允许运行 |
| ------- | ------------ | -------------- | -------- |
| `0`     | 否           | 否             | 否       |
| `1`     | 是           | 是             | 是       |
| `2`     | 是           | 否             | 是       |
| `3`     | 否           | 是             | 是       |

四种状态都有明确用途：

* **`0`** —— 彻底下线一个过时功能，代码仍然留在仓库里
* **`1`** —— 正常可用
* **`2`** —— 照旧运行，但前端不再显示设置项
* **`3`** —— 只保留设置项供查看/修改，配置不读盘

运行期遇到缺失的 key、越界的取值或未知 id 一律按 `0` 处理；
而 `npm run check` 会在构建前拦住清单与代码不一致的情况。

功能还可以声明自己只适用于某一个前端（`frontends: ["mobile"]`）：声明之后，
另一端既不会挂载实现，也不会在设置面板里出现。

### 清单管"能不能"，开关管"做不做"

这两件事刻意分开：

* `feature-control.json` 只决定**加不加载已有配置**、**设置面板显不显示**这个功能
* 功能**实际会不会运行**由它自己的控件决定 —— 面板里每个功能的第一行都是一个
  **默认关闭**的开关（`enabled`），下拉 / 输入框才是它的参数

所以新装插件时**所有功能都是关的**，得你自己去「设置 → 集市 → 已下载 →（本插件）→ 设置」
里逐项打开；关掉时功能会被**完整卸载**（样式、监听、注入的节点全部撤掉），不需要重载插件。
只有两个功能例外，它们的需求本身就是「用一个 selector 当开关」，那个 selector 的
**禁用**选项就是关：`inline-code-copy`、`mobile-longpress-menu-label`。

`state: 2` 的功能在面板里没有开关可点，因此按「已允许运行」处理 —— 否则它就变成了一个
永远不工作的状态。

## 功能清单

### 功能

| 功能                      | 适用前端 | 说明                                                                                        |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `code-block-lang-empty`   | 两端     | 新建代码块时语言总是为空，不再沿用上次选过的语言                                            |
| `daily-note-direct`       | 两端     | 创建日记不弹询问，直接写进设置里选定的笔记本；创建逻辑仍走思源自己的通路                    |
| `first-doc-icon`          | 两端     | 文档首次添加图标时用指定的 emoji，而不是随机一个                                            |
| `external-link-confirm`   | 两端     | 跳转 http/https 链接前弹窗确认，弹窗里显示完整原始链接                                      |
| `kernel-reconnect-button` | 两端     | 断连面板上加一个「立即重连」按钮（实验性）                                                  |
| `kernel-auto-reconnect`   | 两端     | 断连时按设置的次数与间隔自己探测内核，探测到恢复就立刻重载前端（实验性，默认 2 次 / 500ms） |

### 界面

| 功能                          | 适用前端 | 说明                                                                      |
| ----------------------------- | -------- | ------------------------------------------------------------------------- |
| `modal-blur`                  | 两端     | 弹窗遮罩加高斯模糊，被遮住的编辑区虚化，弹窗本身保持清晰                  |
| `doc-tree-opened-accent`      | 两端     | 文档树中当前打开的笔记左边缘显示贴合强调色，色值与宽度可自定义            |
| `inline-code-copy`            | 两端     | 行内代码复制按钮：禁用 / 悬浮（推荐）/ 总是                               |
| `code-snippet-highlight`      | 两端     | 代码片段编辑框按 CSS / JS 上色，复用思源的 highlight.js 与当前高亮主题    |
| `desktop-command-panel-slim`  | 桌面端   | 命令面板宽度缩到思源原生宽度的指定百分比（默认 50%）                      |
| `mobile-sidebar-blur`         | 移动端   | 移动端侧面板高斯模糊                                                      |
| `mobile-dock-blur`            | 移动端   | 移动端悬浮 dock 栏高斯模糊                                                |
| `mobile-bar-animation`        | 移动端   | 顶栏 / 面包屑 / 悬浮 dock 栏滚动显隐的平滑过渡，dock 栏只做整体显示或隐藏 |
| `mobile-ref-panel-height`     | 移动端   | 移动端候选浮层（含引用搜索）按视口比例增高，不会超出可视区底部            |
| `mobile-tab-doc-icon`         | 移动端   | 移动端页签页默认文档图标用 SVG、emoji 或跟随思源设置                      |
| `mobile-sync-button`          | 移动端   | 右上角总是显示「立即同步」，点击行为沿用思源原生同步引导                  |
| `mobile-select-native`        | 移动端   | 下拉选择器用思源原生菜单，而不是 WebView 默认弹层                         |
| `mobile-longpress-menu-label` | 移动端   | 长按菜单里的复制 / 粘贴补上文字（禁用 / 复制 / 粘贴 / 两者）              |
| `mobile-block-icon-always`    | 移动端   | 操作某个块时它的块标保持显示，不再时而显示时而隐藏                        |
| `hide-mobile-exit`            | 移动端   | 隐藏侧面板里只有图标的「退出应用」按钮                                    |

### 开发

| 功能                 | 适用前端 | 说明                                                                   |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| `mobile-console-log` | 移动端   | 从插件加载起收集控制台输出，设置面板里一键查看完整日志、复制全部或清空 |

## 设置面板

插件**不在顶栏、状态栏、停靠栏注册任何入口**。
它覆盖了 `Plugin.openSetting()`——宿主正是靠「是否覆盖了这个方法」来决定要不要在插件卡片上显示
「设置」按钮——所以打开方式是：**设置 → 集市 → 已下载 →（本插件）→ 设置**。

面板是一列纵向滚动的设置项，三个分类（功能 / 界面 / 开发）作为小节标题，
没有侧边页签、没有底栏。每个分类标题之下直接就是设置行：
每个功能第一行就是它自己（功能名 + 说明 + 默认关闭的开关），
它的参数行排在下面，行与行之间保留思源 `.b3-label` 自带的那条细分割线。
**任何一层都没有嵌套分组** ——
`SettingField` 里根本没有分组型字段，层级在类型上就写不出来。
拿 selector 当开关的功能（`inline-code-copy`、`mobile-longpress-menu-label`）同理：
那个下拉就排在功能名这一行的右边，不另起一行。
文案只有两种角色、两档字重：**只有功能名加粗**，它下面的子设置项与说明都是常规字重。
每一行都是「左侧文案 + 右侧控件」，用思源自己的类名
（`b3-switch`、`b3-select`、`b3-text-field`、`b3-label`、`config-item`、`config-title`），
行内边距沿用内核的 `16px 24px`，不做覆盖。
只在单端生效的功能，**在另一端的设置面板里不出现**：移动端专属项不会出现在桌面端的面板里，
桌面端专属项（如命令面板瘦身）也不会出现在移动端。

**保存**与内置弹窗一致：随便改多少项，最后点「保存」；点「取消」则全部丢弃。
不点保存不写盘；某个值校验失败时面板保持打开并报出问题。有未保存的改动时关闭会先确认。

每次保存都会**写后读回校验**：写完某个功能的文件后立刻读回比对。宿主的 `saveData` 在文件真正落盘前
就可能 resolve（而且从不检查内核返回码），所以「没报错」不等于「存住了」。读回不一致时面板保持打开、
直接告诉你是哪个字段对不上，控制台也会打一行 `[some-settings-siyuan]`——设置要是看起来没生效，先看那里。

窄屏（移动端，或宽度小于 750px 的窗口，与内核同一断点）下面板改为上下两段布局：
**参数行**的文案占满一行、控件另起一行撑满宽度，同时收窄弹窗内边距，让内容用满整屏；
功能名那一行仍保持左右布局（右边是开关或下拉），不会被挤到第二行。

`state: 3` 的功能照样显示控件，此时点保存也会写入它自己的 JSON 文件——
四态约束的是**读取**，而不是「用户显式保存的修改要不要留下」。

## 目录结构

```text
some-settings-siyuan/
├── feature-control.json        # 唯一调控入口：每个功能 id 的四态开关
├── plugin.json                 # 集市清单
├── src/
│   ├── index.ts                # 插件入口：onload / onunload / uninstall / openSetting
│   ├── i18n/{en,zh-CN}.json    # 界面文案
│   ├── core/                   # 机制层，这里不放任何业务功能
│   │   ├── types.ts            # FeatureDefinition / SettingField / FeatureHost
│   │   ├── control.ts          # 读取 feature-control.json，归一化四态
│   │   ├── frontend.ts         # 「桌面端 / 移动端」的唯一判定入口
│   │   ├── registry.ts         # 唯一静态导入全部功能的文件
│   │   ├── config.ts           # 每个功能的 JSON 读取 / 保存（草稿提交）/ 重置
│   │   ├── style.ts            # 可撤销的 CSS 注入
│   │   ├── ui.ts               # 原生风格 UI 基元
│   │   ├── error.ts            # 错误隔离，绝不让单个功能拖垮插件
│   │   ├── setting-dialog.ts   # 单列设置面板 + 取消/保存
│   │   └── bootstrap.ts        # 按清单装载并挂载各功能
│   └── features/<id>/{index.ts,<impl>.ts}
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
7. 访问平台能力一律通过 `FeatureHost`（`addCommand`、`addEventBus`、`addStyle`、`addTopBar` 等）。
   功能之间不得互相 import；共用逻辑放 `src/core/`。
8. 设置项支持四种取值控件与一种动作行：
   * 每个功能**必须**有一个默认关闭的控件：`key: "enabled"` 且 `default: false` 的 `switch`，
     或者自己声明 `isEnabled(config)` 谓词（拿 select 的「禁用」选项当开关时走这条）。
     `npm run check` 会拦住两样都没有的功能
   * `switch` / `text` / `number` / `select` —— 参与配置的读取与「保存 / 取消」
   * `select` 除了静态 `options`，还可以用 `optionsProvider` 在面板打开时现算候选集
     （笔记本、插件列表这类只有运行时才知道的数据），此时不做白名单校验
   * `button` —— 只触发一次动作、没有可持久化取值（例如「打开控制台日志」）。
     它不进草稿，因此在只读 / 发布模式下会被禁用
     仍然没有分组型字段：面板是扁平的一层，分组会重新引入层级。
9. 功能**关闭时不会被挂载**，所以实现里不要依赖 `addTopBar` / `addDock` / `addTab` / `addCommand`
   这类「必须在 onload 同步注册」的 API。确实需要的话，把 `mount` 写成无条件执行、
   在内部自己按 `isEnabled` 收放。

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
* **不改核心 DOM** —— 优先 CSS、事件监听与官方扩展点；确实需要落笔时只做增量
  （加一个属性、插一个按钮、搬回内核自己刚渲染过的那份 DOM），绝不删改内核节点。
* **模块隔离** —— 一个功能一个文件夹，功能之间零 import。
* **可回退** —— 任何功能异常都被捕获上报，绝不向外冒泡；卸载逻辑幂等，
  卸载时把偏好、属性描述符、注入的标记都还原。
* **默认关闭** —— 未明确指定默认值的地方一律关闭或跟随思源自身设置。

## 已知限制

* 关闭功能**不会**把它的代码从产物里移除。门控只在运行时生效，这样改
  `feature-control.json` 永远不需要改源码或条件导入；代价是包体大小换「改一个数据文件即可禁用」。
* **功能关着的时候不挂载**，因此它不能使用 `addTopBar` / `addDock` / `addTab` / `addCommand`
  这类必须在 onload 同步注册的 API。当前 22 个功能都没用到；将来要用的话，
  那个功能的 `mount` 得写成无条件执行、内部自己按开关收放。
* `mobile-console-log` 只在开关打开之后才开始收集控制台输出 —— 默认关闭意味着
  插件加载阶段（以及打开开关之前）的日志不会被记录下来。要抓启动期的问题，
  先打开开关，再复现一次。
* 插件刻意不在顶栏/状态栏放任何入口，唯一入口是「设置 → 集市 → 已下载」里插件卡片上的「设置」按钮。
* 保存以一次面板会话为单位：「保存」写入所有被改动的功能的 JSON 文件，「取消」什么都不写。
  面板里没有单项重置按钮；要恢复默认值，删除 `data/storage/petal/some-settings-siyuan/` 下对应文件即可。
* **"立即重连"意味着重载前端**：内核没有给插件「重新建立主 WebSocket」的入口
  （`Model.connect` 需要只存在于内核启动闭包里的 `msgCallback`，再调一次会把内核推送全丢掉），
  所以 `kernel-reconnect-button` 与 `kernel-auto-reconnect` 在探测到内核恢复后整页重载。
  文档内容始终由内核持有并随时落盘，重载不会丢笔记。
* `first-doc-icon` 会写文档的 `icon` 属性，并就地更新标题区、文档树、固定页签与大纲里的图标。
* `code-snippet-highlight` 依赖思源自己的 highlight.js；它迟迟加载不出来时插件会
  主动拆掉高亮层，编辑框回到普通的纯文本状态，不会留下看不见字的输入框。
* `mobile-select-native` 是尽力而为：个别内核 / 系统组合仍可能弹出系统自己的下拉弹层，
  此时选择器行为与未启用插件时完全一致。
* **移动端的复制走 App 注入的原生桥**：安卓 / iOS 的 WebView 没有把剪贴板写权限给页面，
  `navigator.clipboard` 在那里会被拒绝。所以 `mobile-console-log` 的「复制全部」与
  `inline-code-copy` 的复制按钮在移动端走 `JSAndroid.writeClipboard` /
  `webkit.messageHandlers.setClipboard`，桌面端与浏览器才用 Clipboard API，最后都留了
  `execCommand("copy")` 兜底。
* `inline-code-copy` 的「悬浮显示」在移动端按**光标位置**判定：移动端没有 hover，
  所以手指点在（或选到）某段行内代码、光标落进去时按钮就出现，按钮本身也比桌面端大一圈。
  点按钮不会抢走编辑区焦点，键盘与光标都留在原处。
* `mobile-tab-doc-icon` 在没有图标时换掉的是**整个**图标元素：思源在这种情况下渲染的
  `<svg class="mobile-tabs__item-icon">` 里放不了 emoji（SVG 不渲染裸文本），
  所以插件换成思源自己给 emoji 图标用的 `<span>`，样式与内核完全一致。
* 功能被禁用后再重新启用插件命令需要重载插件：宿主 API 没有单条命令的移除接口，
  命令只随插件一起释放。

## 许可证

[MIT](./LICENSE)
