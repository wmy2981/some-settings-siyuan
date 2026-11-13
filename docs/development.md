# 开发笔记

只记「读代码看不出来」的东西：宿主行为、踩过的坑、必须遵守的约束。
API 签名、样式类名、文件布局，以及每个功能**为什么**这么做，都能在 `src/` 里直接读到
（各功能写在自己的模块头注释里），这里不重复；README 只留用户能感知的结论。
设置面板的机制见 [setting-panel.md](./setting-panel.md)。

**不要为了让某个功能跑起来而放宽这里的限制**（跨 feature import、直接改核心 DOM 之类）。
先讨论，再改规范。

---

## 配置与存储

* **「没报错」不等于「存住了」。** 宿主的 `saveData` 在文件真正落盘前就可能兑现，回调也从不检查
  响应 `code`；内核回负数 code（-1、-3 这类）时请求层直接拦截，`fetchPost` 的成功与失败回调都不触发，
  Promise 会永远悬着。所以写盘必须写后读回校验，失败必须让用户看见。
* **列目录用 `fetchSyncPost`**（任何 code 都会兑现），并传 `process: false`；插件 API 里没有列目录，
  走内核 `/api/file/readDir`。
* **导出 / 导入 / 清除 / 卸载按存储目录里的文件来，不按注册表里的功能来。** 声明里的 `enabled`、
  前端适配、`minAppVersion` / `maxAppVersion` 只决定功能加不加载；退役的、甚至已经从插件里删掉的
  功能，配置文件仍躺在 `data/storage/petal/<插件名>/` 下。
* **卸载时 petal 存储要插件自己清**：内核只删插件包目录与集市元信息。`uninstall` 只有 **5 秒**预算，
  所以只做「列一次目录 + 逐个删 + 最后删掉整个目录」—— 功能自己建的子目录（`icons/` 这类）逐个删文件
  清不掉；删不掉只记日志。
* **写进 HTML 属性的复合标识只能用可打印分隔符。** HTML 属性会把 U+0000 换成 U+FFFD（65533），
  拼进去的不可打印分隔符读回时已经切不开、匹配不上 —— 现象是「改完、重开还是默认值」且没有任何报错。

## 功能生命周期

* **功能关着时根本不挂载**，所以不能用 `addTopBar` / `addDock` / `addTab` / `addCommand` 这类必须在
  `onload` 同步注册的 API；真要常驻就把 `mount` 写成无条件执行、内部按开关收放。
  `addProtyleSlash` 是例外：宿主每次打开斜杠菜单才读数组。
* **门控只在运行期生效**：关掉一个功能**不会**把它从产物里移除，也不必条件导入 —— 代价是包体大小。
  这正是「退役功能只把 `enabled` 改成 `false`、不必删代码」的前提。
* **上游做到同一件事后要能退场**：声明 `maxAppVersion`（闭区间），宿主版本超过就不再加载、不显示、
  不挂载。反过来，补丁只对某个版本之后才存在的差异有效时用 `minAppVersion`。都不是「删掉功能」或
  「加一个已失效的开关」。
* **功能被禁用后再启用，插件命令要重载插件才回来**：宿主没有单条命令的移除接口，命令只随插件释放。

## 宿主 DOM 与 API

* **`getAllEditor()` 返回的 `Protyle` 是外壳，真正的编辑器在 `protyle.protyle`（`IProtyle`）。**
  外壳上没有 `element` / `block` / `disabled`，取 `editor.element` 得到 `undefined`，`.find()` 直接失配。
  `.protyle-wysiwyg` 容器**没有** `data-node-id`，取文档 id 要用 `.protyle-background[data-node-id]`
  或 `.protyle-title[data-node-id]`。取空值的效果是「完全不生效」外加一条日志。
* **宿主投影出来的富标题（`.document-title-preview`）整块都不能碰。** 思源把标题存成行级 AST，
  再投影进文档树、页签条、大纲行与移动端页签概览。对它 `replaceChildren` 会整块吃掉标题里的格式、
  引用、标签与公式（`a_b`、`1*2` 这种普通标题就够触发）；用 `textContent = …` 还原会把富标题永久压成
  纯文本。一律按这个类早退，既不渲染也不还原。顺带：`span[data-type~="code"]` 也会出现在文档树、
  页签与大纲里，任何「给正文行内元素挂东西」的功能都要把它排掉。
* **图标容器可能就是那个 `<svg>` 本身。** 往 `<svg>` 上写 `textContent` 只会插一个文本节点，
  SVG 不渲染裸文本，结果是「一片空白」，而 `querySelector("svg use")` 照样命中它内部的 `<use>` ——
  判断通过不等于写法正确。要换内容就把整个元素换成内核自己用的 `<span>`；自己改 DOM 的
  `MutationObserver` 要在写入前 `disconnect()`。
* **资源菜单不要用事件给的 `detail.menu`**：内核会把插件往里加的东西整体收进菜单末尾的「插件」
  子菜单。要加到当前正在构建的那个菜单上，才和信息行同级。
* **观察 `fetch` 响应必须在宿主碰响应体之前 `clone()`**：靠的是「我们的 `.then` 比宿主的 `await`
  先注册、先执行」。挂在 `fetch` 上的观察者都得守这一条。补数据时要换新的对象，而不是就地改字段 ——
  界面可能按对象缓存过展示文本。
* **把 DOM 文本送进剪贴板前，要按内核复制通路做一遍规范化**：思源在语义行内元素里塞了不可见标记
  （现在是 `\u2060`，旧文档是 `\u200b`），它就在 `textContent` 里，手动选中复制走内核的剥离通路所以干净。
  `\u200d` 要留给 emoji，不能删。作用面只认正文，富标题里整块排掉。
* **外链统一走 `core/link.ts`**：它先发内核同款的 `open-link` 插件事件（这样别的插件能拦，本插件自己的
  「外链跳转前确认」也才拦得到），没人取消才退回 `window.open`。面板自己画的入口各写一份，迟早漏掉一处。
* **移动端剪贴板走 App 注入的原生桥**：安卓 / iOS 的 WebView 不给页面剪贴板写权限，`navigator.clipboard`
  会被拒绝，要走 `JSAndroid.writeClipboard` / `webkit.messageHandlers.setClipboard`；桌面端与浏览器用
  Clipboard API，最后都留 `execCommand("copy")` 兜底。

## 样式

* **注入的 `<style>` 必须每次重写内容**，不能在元素已存在时直接 return。「禁用 / 启用」与「重载插件」
  都**不会重载页面**，`<head>` 里的旧样式会留下来，于是新代码配一份旧样式表：**JS 改的 DOM 生效了，
  CSS 改的东西纹丝不动，重载多少次都没用，只有整页刷新才恢复**。排查 UI 改动「没生效」先怀疑这一条。
* **`flex-wrap` 的折行判定发生在收缩之前**：浏览器先按基准尺寸（`flex-basis`）判断放不放得下，
  放不下就换行，换行之后没有收缩机会。要让控件留在同行，功能行得用 `flex: 1 1 0` 让基准取 0。
* **`:first-child`、`:not(.x)` 里的选择器都算特异性**，想覆盖内核的规则必须补一级，光靠「写在后面」没用。
* **`backdrop-filter: revert` 回滚不到宿主那条规则**：`revert` 回的是级联来源（浏览器默认值），不是
  「上一条作者样式」，于是想「交还宿主」会得到 `none`。正确做法是一开始就别匹配
  （`:not(.b3-dialog__scrim--progress)`，进度遮罩自 3.8.9-alpha.6 起由宿主自己写底色与模糊），
  宿主的声明根本没被覆盖。
* **两层对齐（透明输入框 + 底层高亮层）时，主题自带的高亮样式必须压掉。** highlight.js 主题里的
  `pre code.hljs { padding: 1em }` 特异性高于自写规则，会把高亮层整体错开；主题的 `background`
  也会盖住输入框。用更深的特异性（`.__highlight > code.hljs`）或 `!important`。
  * 输入框的 `color` / `background-color` **只能在变透明之前抄一次**：生效后它俩算出来是透明的，
    每帧再抄一次会让高亮层的字一起消失。
  * **字体要显式继承到 `code`**：浏览器给 `code` 定死了 `font-family: monospace`，直接命中的规则永远
    赢过继承，只抄在 `pre` 上不够。字宽不同会让光标随行长越来越偏；连字同理，`.b3-text-field` 是
    `font-variant-ligatures: none`，抄漏了 `->` `ffi` 会被合成更窄的字形。
  * **输入法组字串只在输入框里**，`textarea.value` 里还没有它，高亮层渲染不出来：组字期间把可见性
    交还输入框（`compositionstart` / `compositionend`），结束再换回来。

## 交互

* **不要为「用户离开」自己发明一个信号。** 面板的生命周期只有它自己的显式动作：关面板、Esc、插件卸载。
  `window` 的 blur / focus 不等于用户离开（软键盘收放、系统弹层、思源菜单、桌面端切走再回来都会派发）；
  `document` 的可见性也不等于（Chromium 的原生窗口遮挡检测把「窗口被完全盖住」也算 hidden）。
  换判据只是换了个误判来源。
* **用自定义菜单顶替原生 `<select>` 时，必须把随后那次 `click` 也吞掉。** 内核的全局 click 处理器见到
  「点在菜单外面」就收掉菜单，于是菜单闪一下就消失；而手指在控件上滑动不产生 click，现象就成了
  「只有滑动能用、点按不行」。捕获阶段 `preventDefault()` + `stopPropagation()` 能同时挡住浏览器默认弹层
  与这次 click。
* **拦原生 `<select>` 弹层不要在 `touchstart` 里 `preventDefault()`**：那会连页面滚动一起取消，手指落在
  下拉控件上就再也划不动。原生弹层属于「点击」的默认行为，在 `touchend` 里取消一次就够
  （`pointerdown` / `mousedown` 上取消不影响触摸滚动，可以留着挡鼠标那条路径）。
* **面板里的按钮点一次只能跑一次流程**（连点会冒出好几个弹窗、同一批配置导入两遍）。
  用 `core/click.ts` 的 `bindPendingClick` 绑定，见 [setting-panel.md](./setting-panel.md)。

## 已知盲区

改这两个功能之前先看一眼，代码注释里没有这些后果：

* **`bookmark-last-position` 管不到已打开的那条路**：文档已经在某个页签打开时走的是宿主的 `switchEditor`，
  那条路对文档树也一样不重新定位。
* **`agent-thinking-sticky-header` 直接写 `scrollTop` 会被宿主的 scroll 监听当成「用户自己滚了一下」**
  （插件拿不到它那套「程序化滚动」标志），于是自动贴底停下、冒出「回到底部」按钮。

## 构建与测试

* **压缩会吃掉 `console.log`。** minimizer 默认移除 console 调用，于是「出问题但控制台全空」。
  构建配置里 `drop: []` / `pure: []` 是**显式钉住这一条**，防止换 minimizer 或有人加 `drop_console`
  之后日志悄悄消失，不要删。
* **测试分 `vm` / `forks` 两个 project**：绝大多数文件走 `vmThreads`；只有整块替换 `window.location`
  的那两个文件留在默认进程池（VM 上下文里连 `Object.defineProperty` 都拒绝）。**VM 不是完整 Node**：
  `ReadableStream`、Web Crypto 要在 `tests/setup.ts` 里补，`crypto.subtle` 还得同时挂到 `window.crypto`；
  动 DOM 的那几行必须先 `typeof document !== "undefined"` 判断，否则 node 环境直接抛错。
  子 project 的 `include` / `exclude` / `setupFiles` 是**拼接**而不是覆盖，所以文件清单只在 project
  里写一次；纯逻辑文件第一行写 `// @vitest-environment node`。`poolMatchGlobs` 已经删除，别再试 ——
  写了既不报错也不生效。
* **`siyuan` 在 npm 上只有类型声明**，运行时由宿主注入。单元测试整块换成 `tests/mocks/siyuan.ts`：
  前端类型、内核响应、对话框结构与 confirm 答案改它的 `mockState`；`window.siyuan`（版本号、只读 /
  发布态、容器类型、插件列表）直接改全局，初值在 `tests/setup.ts`。测试没关掉的面板由
  `closeOpenSettings()` 兜底 —— 丢掉实例会留下一个在环境拆除后才触发的定时器。
