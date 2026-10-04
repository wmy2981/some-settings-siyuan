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
   还有两处同样的坑，都会表现成**「光标和文字之间空一段」**：
   * **字体没被继承下来。** 浏览器的默认样式给 `code` 定死了 `font-family: monospace`，
     而"直接命中该元素"的规则永远赢过从父级继承来的字体 —— 把字体抄在 `pre` 上不够，
     必须再给 `code` 写一条 `font: inherit`。两套字体的字宽不同，光标（输入框画的）
     会随行长越来越偏离可见文字：实测 8 个字符差 6px、96 个字符差 75px。
     连字同理：`.b3-text-field` 是 `font-variant-ligatures: none`，抄漏了就会让
     JetBrains Mono 把 `->` `!=` `ffi` 合成更窄的字形，也要一起镜像。
   * **输入法组字串会跟着输入框的文字一起消失。** 组字串只在输入框里，`textarea.value`
     里还没有它，高亮层渲染不出来；而输入框的文字被藏成了透明。
     所以要监听 `compositionstart` / `compositionend`：组字期间把可见性交还输入框
     （它恢复原色、高亮层的文字让位只留底色），组字结束再换回来。

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

12. **不要为「用户离开」自己发明一个信号。**
    设置面板曾经在窗口失焦时收掉自己（后来改成 `document` 隐藏），理由是「用户离开了，
    别留下失效弹窗」。这个理由站不住，两种判据都会误判：
    * `window` 的 blur / focus 不等于用户离开：软键盘收起或弹起、系统弹层、思源自己的菜单
      （移动端展开前会 `blur()` 掉当前输入框并收起键盘）、桌面端「去看一眼别的应用再回来」
      都会派发这一对事件；
    * `document` 的可见性也不等于用户离开：Chromium 的原生窗口遮挡检测（Windows 上默认开启）
      把「窗口被别的窗口完全盖住」也算成 hidden，于是桌面端切到另一个最大化的窗口再回来，
      面板照样被关掉 —— **换判据只是换了个误判来源**。
      面板真正的生命周期就是它自己的显式动作：取消、保存、Esc、插件卸载。用户切出去再回来，
      DOM 弹窗还在原处，草稿也没丢，什么都不用做。
      **规则：不要自己造「用户离开」的信号；要收 UI 就绑定用户的显式动作。**

13. **拦原生 `<select>` 弹层时不要在 `touchstart` 里 `preventDefault()`。**
    在 `touchstart`（或第一个 `touchmove`）里取消默认行为会连**页面滚动**一起取消：
    手指落在下拉控件上时页面就再也划不动了，而用户根本不会把这两件事联系起来。
    原生弹层属于「点击」的默认行为 —— 在 `touchend` 里取消一次就够（`pointerdown` /
    `mousedown` 上取消不影响触摸滚动，可以留着挡鼠标那条路径）。

14. **内核会用 `.config__tab-container` 认「哪个弹窗是设置弹窗」，这个类名借不得。**
    打开思源自己的设置时，内核先做一件事（`app/src/config/index.ts` 的 `openSettingDialog`）：

    ```js
    window.siyuan.dialogs.find((item) => item.element.querySelector(".config__tab-container"))?.destroy();
    ```

    只要插件面板里出现了这个类，它就会被 `find` 命中，于是用户**再打开一次思源设置**就可能
    连带把插件面板关掉 —— 面板里的草稿一起消失，而用户什么都没做错。
    仿原生外观时只借**纯样式类**（`b3-list-item`、`layout-tab-bar`、`item`、
    `.config-items`、`.b3-label`），结构类（`.config__panel` / `.config__side` /
    `.config__tab-wrap` / `.config__tab-container`）一律用自己的类名复刻形制。

15. **页签栏的底色要跟着弹窗容器走，不能留着内核给 `.layout-tab-bar` 的那一份。**
    内核的 `.layout-tab-bar` 自带 `background-color: var(--b3-theme-background)`，
    而弹窗容器 `.b3-dialog__container` 的底色是 `--b3-theme-surface` —— 深色主题下是
    `#1e1e1e` 与 `#2c2c2c`、浅色主题下是 `#fff` 与 `#f6f6f6`，两两都不同。
    于是页签栏在标题下面变成一条明显的色带；如果还自己给它加一圈上圆角，容器的底色就会从
    两个角上露出来，看起来就是「圆角没贴合」。
    内核代码片段弹窗没有这个问题，只是因为它的页签栏正好在弹窗最顶端、圆角与容器重合。
    本面板的页签栏上面还有标题栏，所以**底色取 `transparent`**（露出来的就是容器自己的底色，
    深浅主题都一致），**圆角一律不要**。

---

## 各功能的实现取舍

这些细节原来写在 `README` 的「已知限制」里，属于实现层面；README 只留用户能感知的结论。

* **门控只在运行期生效。** 关掉一个功能**不会**把它的代码从产物里移除：这样才能做到「改一个数据文件即可禁用」，
  永远不需要改源码或条件导入。代价是包体大小。
* **功能关着的时候根本不挂载**，所以实现里不能用 `addTopBar` / `addDock` / `addTab` / `addCommand`
  这类必须在 onload 同步注册的 API。当前 33 个功能都没用到；将来要用的话，那个功能的 `mount`
  得写成无条件执行、内部自己按开关收放。
* **移动端复制走 App 注入的原生桥。** 安卓 / iOS 的 WebView 没有把剪贴板写权限给页面，
  `navigator.clipboard` 在那里会被拒绝。所以 `mobile-console-log` 的「复制全部」与 `inline-code-copy`
  的复制按钮在移动端走 `JSAndroid.writeClipboard` / `webkit.messageHandlers.setClipboard`，
  桌面端与浏览器才用 Clipboard API，最后都留了 `execCommand("copy")` 兜底。
* **功能被禁用后再启用插件命令需要重载插件**：宿主 API 没有单条命令的移除接口，命令只随插件一起释放。
* **`inline-code-copy` 的按钮在按下时就复制**，不等 `click`：表格单元格的富编辑器把「单元格之外的
  `pointerdown`」当成收尾信号，收到就重建整个单元格，行内代码连同它的布局盒一起消失，按钮随即被
  按「宿主已断开」收掉 —— 这一串都发生在 `mouseup` 之前，`click` 永远不会派发到按钮上。
  键盘与无障碍工具派发的是 `detail` 为 0 的 `click`，那条路仍旧走 `click`。
  **移动端那一下还要更早一步拦下来**：光"按下即复制"只解决了"复制不到"，单元格照样被重建，
  承载光标的编辑器与**浏览器的选区**一起消失，而按钮的 `preventDefault()` 又不让焦点落到别处。
  之后手指落在**空单元格**上就再也点不进去 —— 空单元格是唯一被内核 `preventDefault()` 掉
  浏览器落点的单元格（`td:empty`），它只能靠"已有选区 + focus"这条移动端的路，而选区刚被销毁。
  所以在 **window 捕获阶段** `stopPropagation()`（比宿主的 document 捕获更外层，宿主根本收不到），
  单元格不再重建，编辑器、光标与键盘原封不动，之后点别的单元格就是思源原生的换格流程。
* **`exit-confirm` 守的是渲染进程发出的那一次 `POST /api/system/exit`** —— 菜单退出、托盘退出、
  关窗即退出最后都落到它上面，三者请求体一字不差；渲染进程里唯一还能区分托盘退出的判据是窗口状态，
  所以只在前台窗口发问。两条路仍然拦不住，因为没有任何插件 API 能够到它们：连接**远程内核**时退出不发这个请求；
  请求本身失败时宿主的兜底是直接发 `siyuan-quit`。
* **`recording-window` 靠那条永不消失的录音提示驱动**：认出它、把它藏起来（留在 DOM 里，
  因为它那个按钮是 `stopRecord` 的唯一入口），内核收掉它时浮窗跟着关闭。移动端每秒重算一次
  底部操作条与键盘工具栏的**顶沿**（不是高度：底部操作条浮在视口底边之上，只量高度会让浮窗压住它），
  键盘弹起时还会重新抢回层级，所以始终待在它们上方。
* **`bookmark-last-position` 管不到已打开的那条路**：文档已经在某个页签打开时仍走思源自己的 `switchEditor`，
  那条路对文档树也一样不重新定位。
* **`tab-title-markdown` 把语法字符留在 DOM 里只是隐藏**，所以 `textContent` 依旧是原标题 ——
  `document.title`、拖拽载荷、页签下拉列表的文字都从它取。思源会在**原文没变**的时候重写页签标题：
  打开文档时 `Title.render` 拿文档树里那份标题再调一次 `Tab.updateTitle`，而它直接写 `innerHTML`。
  所以「这份原文已经渲染过」的去重不能只看 `textContent`，还要确认节点里仍带着我们的标记，
  否则那次重写会被当成「已经渲染过」，页签从此停在纯文本上（只在打开的一瞬间看得到渲染结果）。
* **`deepseek-balance` 的余额行跟着面板走**：思源的智能体面板是懒创建的，也可能被整体换掉
  （移动停靠位置、切换布局、移动端每次重新打开），所以只要 body 有变化、以及每个轮询周期，都会重新插一次。
  只有当前模型不是「已启用的官网 api.deepseek.com DeepSeek 模型」时整行才收起。
* **`oss-usage` 按阿里云 OSS 的 V1 方案签名**：GetBucketStat 是 `GET /?stat`，待签字符串的布局照抄官方
  浏览器 SDK —— 时间用 `x-oss-date` 传：待签字符串里 Date 那一格填它的值，同时它本身作为 `x-oss-*` 头
  再出现一次。规范化资源是 `/<bucket>/?stat`，虚拟主机风格与 path 风格是同一个。
  **请求必须由内核发出**：移动端 WebView 里直连 OSS 是跨域请求，桶上没有 CORS 规则时预检就被拒，
  用户只看到一句 `Failed to fetch`；改走 `/api/network/forwardProxy` 后两端走同一条路。转发时内核
  **一定会**替我们写一个 Content-Type，而它是待签字符串的一格，所以那一格必须用显式传给内核的值
  （留空就会与服务端重算的结果不一致，全变成签名错误）。
* **`panel-no-autofocus` 要盖住思源自己的设置弹窗**：桌面端一打开就会把焦点放到设置搜索框上。
  拦截分两层，缺一不可：`focusin`（document 捕获）管同步落点 —— 思源就是在打开的同一次调用里
  （`initSettingSearch`）放焦点的，晚一步移动端那一下已经顶起软键盘；另外在面板开着、用户还没动手时
  按固定间隔直接查 `document.activeElement`，因为聚焦也可能来自动画之后或异步回调。
  「用户动过手」的判定：键盘一律算，鼠标只有落在控件、控件标签或按钮上才算 ——
  点标题栏、点侧栏分类都不算，之后程序补上的聚焦照样还回去。
* **`asset-info-menu` 不用事件给的 `detail.menu`**：内核会把插件往里加的东西整体收进菜单末尾的
  「插件」子菜单，而这几行是资源自己的信息，塞进去等于让用户每次多点一层。它改把菜单项加到
  **当前正在构建的那个菜单**上（`window.siyuan.menus.menu`），与思源自己的「更新于 / 创建于」同级，
  前面自己补一条分隔线。它挂的是图片菜单、行内链接菜单与块标菜单三处。
* **`plugin-reminder` 的链接显示成 `owner/repo`，指向的仍是完整地址**；点击时先发内核同款的 `open-link`
  插件事件，所以本插件自己的「外链跳转前确认」会像对待其它外链一样拦下它，没有任何插件取消时才退回 `window.open`。
* **`ref-crumbs-guide` 走目标插件自己的 `openSetting()`**（与集市卡片上那个按钮同一条调用），
  没装时退回 `siyuan://bazaar/plugins/ref-crumbs-siyuan/readme` —— 集市详情页没有官方插件 API。
* **`config-transfer` 导入成功后必须重新载入前端**：设置面板此刻还开着，它手里的草稿是导入之前的值，
  用户再点一次「保存」就会把旧值写回去。
* **配置的导出 / 导入 / 清除 / 卸载要按存储目录里的文件来，不能按注册表里的功能来**：四态、前端适配、
  `deprecatedSince` 都只管功能加不加载，退役的、甚至已经从插件里删掉的功能留下的配置文件
  仍躺在 `data/storage/petal/<插件名>/` 下（本插件历史上删掉的功能就留下过这种文件），
  只看注册表就会漏掉它们，而且 `0` / `3` 的功能不读盘、导出会拿到内存里的默认值而不是文件内容。
  「列出目录里有哪些文件」没有插件 API，只能走内核 `/api/file/readDir`（配置文件名为 `feature-<id>`，宿主不加扩展名）。
* **卸载时 petal 存储要插件自己清**：内核的 `UninstallPackage()` 只删插件包目录 `data/plugins/<插件名>`
  与集市元信息，`data/storage/petal/<插件名>/` 它不碰，而这些文件还参与同步 —— 漏掉的配置文件会一直
  跟着同步走。另外拆除钩子有 **5 秒**预算（`onunload` 与 `uninstall` 共用同一个 deadline，默认 `teardownTimeout` = 5000ms），
  所以卸载里只做「列一次目录 + 逐个删」，删不掉只记日志，不做重活、不再等第二次机会。
* **内核回负数 code 时 `fetchPost` 的回调不会触发**：宿主的 `processMessage` 见到 `code < 0` 就提示并返回 false，
  成功回调与失败回调都不走，于是 `loadData` / `saveData` / `removeData` 的 Promise 会永远悬着
  —— 这也是写盘必须读回校验的原因之一。列目录因此用 `fetchSyncPost`（任何 code 都会兑现），
  并把 `process` 传 `false`，免得内核的报错被宿主再弹成一条没人能处理的错误。
* **`agent-tool-call-detail` 的细节有两条来源**：正在跑的这一轮的事件流（`POST /api/ai/agent/chat` 的 SSE，
  内核在**每个工具执行之前**逐个发 `tool_call`，参数就在里面）与写回后的会话存档（权威、带结果）。
  两条都只是**被动读一遍面板自己已经收到的响应**，不额外发请求。读副本的 `clone()` 必须在宿主碰响应体
  之前调，靠的是「我们的 `.then` 比宿主的 `await` 先注册、先执行」—— 挂在 `fetch` 上的观察者都得守这一条。
  实时数据按卡片对账（界面上唯一那张没有 `--thinking-done` 的思考卡片），卡片切走就丢弃：上一张卡片该显示的
  细节早就画在界面上了。**补结果时换的是一个新的调用对象，而不是就地改字段** —— 界面按对象缓存过一次展示
  文本（`WeakMap`），就地改会一直读到没有结果的旧文本。步骤的切法要与宿主的 `collectCurrentThinkingStep`
  一致（一个 `thinking` 事件起一步），否则「界面上的工具行」与数据对不上，那一行会整行不显示。
