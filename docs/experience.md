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