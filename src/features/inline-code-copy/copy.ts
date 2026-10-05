/**
 * 行内代码复制按钮的实现。
 *
 * 一个按钮对应一段行内代码，按需创建、离开视线就移除（始终模式下一次只处理
 * 当前可见的那些）。定位分两趟：先读完所有 rect，再统一写样式，
 * 避免"写一个读一个"把浏览器拖进反复重排。
 *
 * 作用范围是**所有渲染出来的块内容**，不只主编辑器：编辑器正文、搜索与反链的
 * 预览区、悬浮预览、闪卡、大纲、脑图、AV 富文本单元格、编辑器只读预览、智能体
 * 回复。这几处的标记不一样（见下面的选择器），所以两种都要认。
 *
 * 移动端没有 hover，"悬浮显示"改成"把光标放进这段行内代码即显示"：
 * 手指点在行内代码上会落下光标，`selectionchange` 就是它的信号。
 */
import {copyText} from "../../core/clipboard";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/**
 * 行内代码在思源里有两套标记，取决于渲染路径，两套都要认：
 *
 * - Protyle 渲染出来的 DOM（编辑器正文、搜索/反链预览、悬浮预览、闪卡、大纲、
 *   脑图、AV 富文本单元格）用 `span[data-type~="code"]`，`~=` 是因为长文本换行时
 *   还会带上 `data-inline-wrap`；
 * - 内核直接交给 Lute 渲染 HTML 的区域（编辑器只读预览、智能体回复、集市 README、
 *   收集箱）用 `<code>`，这些内容都挂在 `.b3-typography` 下——**必须限定这个容器**，
 *   否则会把设置界面里那些裸 `<code>` 也当成行内代码。
 *
 * 代码块要排掉，判据是 `:not(pre code)` 而不是思源自己的 `:not(.hljs)`：
 * 高亮类由脚本异步加上去，在那之前 `.hljs` 还不存在，会把整段代码块匹配进来。
 *
 * 智能体**流式**输出每 100ms 重解析一次、节点被反复替换，等消息落定（类名换成
 * 不带 `--streaming`）再挂按钮，既省事也不会闪。
 */
const PROTYLE_CODE_SELECTOR = "span[data-type~='code']";
const HTML_CODE_SELECTOR = ".b3-typography code:not(pre code):not(.hljs)";
const CODE_SELECTOR = `${PROTYLE_CODE_SELECTOR}, ${HTML_CODE_SELECTOR}`;
const STREAMING_SELECTOR = ".agent-chat__body--streaming";
const BUTTON_CLASS = "ss-inline-code-copy";
const DEFAULT_MODE = "off";
/** 行内代码与复制按钮之间那段空隙的容差（px）。 */
const HOVER_GAP = 8;
/** 按钮尺寸：两个端一致，18px。 */
const BUTTON_SIZE = 18;
/** 按钮相对行内代码右上角的偏移。 */
const OFFSET_X = BUTTON_SIZE + 2;
const OFFSET_Y = BUTTON_SIZE - 4;

const COPY_CSS = `
.${BUTTON_CLASS} {
    position: fixed;
    z-index: 3;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${BUTTON_SIZE}px;
    height: ${BUTTON_SIZE}px;
    padding: 2px;
    border: 0;
    border-radius: var(--b3-border-radius);
    background-color: var(--b3-menu-background);
    box-shadow: var(--b3-dialog-shadow);
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
    opacity: .86;
    transition: opacity 120ms linear, color 120ms linear;
}

.${BUTTON_CLASS}:hover {
    opacity: 1;
    color: var(--b3-theme-on-surface);
}

.${BUTTON_CLASS} svg {
    width: ${BUTTON_SIZE - 4}px;
    height: ${BUTTON_SIZE - 4}px;
}
`;

type Mode = "off" | "hover" | "always";

const modeOf = (host: FeatureHost): Mode => {
    const raw = String(host.config.mode ?? DEFAULT_MODE);
    return raw === "hover" || raw === "always" ? raw : "off";
};

/**
 * 行内代码的**可见文本**。
 *
 * 不能直接取 `textContent`：思源会在语义行内元素（code / kbd / tag）内部放一个不可见的
 * 内部标记，编辑器里渲染出来是
 * `\u200b<span data-type="code">\u2060值</span>\u200b` —— 前后那两个零宽空格是兄弟文本节点，
 * 但**内部那个 `\u2060` 就在 `textContent` 里**（旧文档里它是 `\u200b`）。它只是排版用的，
 * 不属于内容：手动选中复制走内核自己的通路，会剥掉内部标记、把 NBSP 换成空格、再删掉零宽空格；
 * 而按钮照 `textContent` 复制，就会把零宽字符一起塞进剪贴板 —— 粘进「填写密钥」这类严格输入框
 * 直接报错。这里照内核那三步做一遍，末尾的换行也一并去掉（内核的代码块复制按钮同样如此）。
 * 零宽连字符（`\u200d`）要留给 emoji，不能删。
 */
const codeTextOf = (span: HTMLElement) =>
    (span.textContent ?? "")
        .replace(/^[\u200b\u2060\ufeff]+/, "")
        .replace(/\u00a0/g, " ")
        .replace(/\u200b/g, "")
        .replace(/\n$/, "");

export const mountInlineCodeCopy = (host: FeatureHost): FeatureInstance => {
    host.addStyle(COPY_CSS);

    const buttons = new Map<HTMLElement, HTMLButtonElement>();
    const mobile = isMobile();
    let hovered: HTMLElement | undefined;
    let frame = 0;

    /** 复制某段行内代码的文本。 */
    const run = (span: HTMLElement) => {
        const text = codeTextOf(span);
        void copyText(text).then((ok) => {
            host.showMessage(ok ? host.i18n("inlineCodeCopy.copied") : host.i18n("inlineCodeCopy.failed"));
        });
    };

    const createButton = (span: HTMLElement): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = BUTTON_CLASS;
        button.title = host.i18n("inlineCodeCopy.label");
        button.setAttribute("aria-label", host.i18n("inlineCodeCopy.label"));
        button.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        // 点按钮不能让编辑区失去焦点：那样会收起键盘、丢掉光标，
        // 「悬浮显示」依赖的那个光标一丢，按钮自己就跟着消失了。
        button.addEventListener("mousedown", (event) => event.preventDefault());
        // 复制挂在按下而不是 click 上：表格单元格的富编辑器把「单元格之外的 pointerdown」
        // 当成收尾信号（`finish()`，在 document 捕获阶段），收到就重建整个单元格 —— 行内代码
        // 连同它的布局盒一起消失，按钮随即被 update() 按"宿主已断开"收掉，而这一切都发生在
        // mouseup 之前，于是 click 永远不会派发到按钮上，表现成「表格里的按钮点不动」。
        // 按下即复制就不受宿主后面怎么重排影响。
        // 移动端这一下在更外层就被拦走了（见 `onButtonPointerDown`），到不了这里。
        button.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            run(span);
        });
        // 键盘（Enter / 空格）与无障碍工具派发的是 `detail` 为 0 的 click，没有对应的
        // pointerdown，鼠标那一次则已经在 pointerdown 里做过了，不能重复。
        button.addEventListener("click", (event) => {
            if (event.detail === 0) {
                run(span);
            }
        });
        document.body.append(button);
        buttons.set(span, button);
        return button;
    };

    /**
     * 这段行内代码此刻看得见吗。
     *
     * 它可能落在被隐藏的容器里（切走的页签、折叠的面板），而按钮是 `position: fixed`
     * 的：容器一藏，按钮就会「飘」在别的面板上，既认不出来源、点它也没有意义。
     * `getClientRects()` 为空即说明它没有布局盒（即在 `display: none` 子树里），
     * 再加上流式输出的排除。
     */
    const isVisible = (element: HTMLElement): boolean =>
        !element.closest(STREAMING_SELECTOR) && element.getClientRects().length > 0;

    /**
     * 移动端的"悬浮"目标：光标所在的那段行内代码。
     *
     * 手指点在行内代码上不会产生 hover，只会落下光标，所以悬浮模式在移动端
     * 改成看选区。取 anchor / focus 两端：选中一段文本时焦点可能在另一侧。
     */
    const focusedCode = (): HTMLElement | undefined => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }
        for (const node of [selection.anchorNode, selection.focusNode]) {
            const element = node instanceof Element ? node : node?.parentElement;
            const code = element?.closest<HTMLElement>(CODE_SELECTOR);
            if (code) {
                return code;
            }
        }
        return undefined;
    };

    /** 始终模式下要考虑的行内代码：正文里的、还在视口内的。 */
    const visibleCodes = (): HTMLElement[] => {
        const mode = modeOf(host);
        if (mode === "off") {
            return [];
        }
        if (mode === "hover") {
            const targets: HTMLElement[] = [];
            if (hovered?.isConnected && isVisible(hovered)) {
                targets.push(hovered);
            }
            if (isMobile()) {
                const focused = focusedCode();
                if (focused && focused.isConnected && focused !== hovered && isVisible(focused)) {
                    targets.push(focused);
                }
            }
            return targets;
        }
        const viewportHeight = window.innerHeight;
        return Array.from(document.querySelectorAll<HTMLElement>(CODE_SELECTOR))
            .filter((code) => isVisible(code))
            .filter((code) => {
                const rect = code.getBoundingClientRect();
                return rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight;
            });
    };

    const update = () => {
        const targets = visibleCodes();
        const wanted = new Set(targets);
        buttons.forEach((button, code) => {
            if (!wanted.has(code) || !code.isConnected) {
                button.remove();
                buttons.delete(code);
            }
        });
        if (targets.length === 0) {
            return;
        }
        // 先读完，再统一写，避免读写交替触发重排
        const rects = targets.map((code) => code.getBoundingClientRect());
        // 贴边时把按钮压回视口内：按钮是 fixed 定位，落在视口外的部分点不到
        const maxLeft = Math.max(2, window.innerWidth - BUTTON_SIZE - 2);
        targets.forEach((code, index) => {
            const button = buttons.get(code) ?? createButton(code);
            const rect = rects[index];
            const left = Math.min(Math.max(rect.right - OFFSET_X, 2), maxLeft);
            const top = Math.max(rect.top - OFFSET_Y, 2);
            button.style.left = `${Math.round(left)}px`;
            button.style.top = `${Math.round(top)}px`;
        });
    };

    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            update();
        });
    };

    /** 指针落在行内代码上，或落在它自己那个复制按钮上，都算"还在这一段上"。 */
    const codeOfTarget = (target: Element): HTMLElement | undefined => {
        const code = target.closest<HTMLElement>(CODE_SELECTOR);
        if (code) {
            return code;
        }
        const button = target.closest<HTMLElement>(`.${BUTTON_CLASS}`);
        if (!button) {
            return undefined;
        }
        for (const [owner, item] of buttons) {
            if (item === button) {
                return owner;
            }
        }
        return undefined;
    };

    const insideOf = (code: HTMLElement, node: Node): boolean =>
        code.contains(node) || Boolean(buttons.get(code)?.contains(node));

    /**
     * 移动端：按钮上这一下按下，不能让宿主看见。
     *
     * 按钮挂在 `document.body` 上，单元格富编辑器把「编辑器之外的 pointerdown」当成收尾信号
     * （`finish()`，document 捕获阶段），收到就 `cell.innerHTML = ...` 重建整个单元格：
     * 承载光标的那个 lite 编辑器子树连同浏览器的选区一起消失，而按钮的 `preventDefault()`
     * 又不让焦点落到别处 —— 这份"选区 + 焦点"一没就回不来了。之后手指落在**空单元格**上时，
     * 浏览器自己的落点已被内核取消（`td:empty` 那条 `preventDefault()`），移动端那条
     * 「先恢复选区、再 focus 顶起键盘」的路又需要一份非空选区，于是空单元格再也点不进去。
     *
     * 在 **window 捕获阶段** `stopPropagation()`：它比宿主的 document 捕获更外层，
     * 宿主那条收尾监听器根本收不到这次事件，编辑器不收尾、单元格不重建、光标与键盘都还在。
     * 之后用户去点别的单元格，走的就是思源原生的「编辑 A 单元格时点 B 单元格」流程。
     *
     * 用 window 而不是 document：同一节点同一阶段按注册顺序执行，而本功能可能是用户在
     * 设置面板里现场打开的，注册顺位不保证在宿主之前。
     */
    const onButtonPointerDown = (event: Event) => {
        if ((event as PointerEvent).button !== 0) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(`.${BUTTON_CLASS}`)) {
            return;
        }
        const code = codeOfTarget(target);
        if (!code) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        run(code);
        // 这一次不会再到 document 上，顺手把「按下后重排」这件事自己做了
        schedule();
    };

    /**
     * 按钮浮在行内代码的右上角，指针从代码滑过去时会先擦过两者之间那一小段空隙，
     * 那一瞬间它在页面上是"什么都不属于"的，不能算离开。
     */
    const nearButtonOf = (code: HTMLElement, event: Event): boolean => {
        const button = buttons.get(code);
        const {clientX, clientY} = event as MouseEvent;
        if (!button || typeof clientX !== "number" || typeof clientY !== "number") {
            return false;
        }
        const rect = button.getBoundingClientRect();
        return clientX >= rect.left - HOVER_GAP && clientX <= rect.right + HOVER_GAP &&
            clientY >= rect.top - HOVER_GAP && clientY <= rect.bottom + HOVER_GAP;
    };

    const onPointerOver = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const code = codeOfTarget(target);
        if (code === hovered) {
            return;
        }
        if (!code && hovered && nearButtonOf(hovered, event)) {
            return;
        }
        hovered = code;
        if (modeOf(host) === "hover") {
            schedule();
        }
    };

    const onPointerOut = (event: Event) => {
        if (!hovered || modeOf(host) !== "hover") {
            return;
        }
        const related = (event as PointerEvent).relatedTarget;
        if (related instanceof Node && insideOf(hovered, related)) {
            return;
        }
        if (nearButtonOf(hovered, event)) {
            return;
        }
        hovered = undefined;
        schedule();
    };

    const clearButtons = () => {
        buttons.forEach((button) => button.remove());
        buttons.clear();
    };

    /**
     * 移动端的光标信号。`selectionchange` 在光标进入 / 离开行内代码时都会派发，
     * 是「聚焦了哪一段」唯一可靠的来源；桌面端不需要，就完全不注册。
     */
    const onSelectionChange = () => {
        if (modeOf(host) === "hover") {
            schedule();
        }
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    if (mobile) {
        // 移动端没有 hover，「悬浮显示」看的是光标落在哪一段行内代码上
        document.addEventListener("selectionchange", onSelectionChange);
        // 按下复制按钮那一下必须拦在宿主之前，见 onButtonPointerDown
        window.addEventListener("pointerdown", onButtonPointerDown, true);
    }
    window.addEventListener("scroll", schedule, {capture: true, passive: true});
    window.addEventListener("resize", schedule);
    // 切页签、换面板、开弹窗都只改 class，不动正文结构，却会让按钮依附的那段
    // 行内代码从视野里消失。一次点击是这些变化最可靠的信号，顺手把游离的按钮收掉。
    document.addEventListener("pointerdown", schedule, true);
    // 编辑会让行内代码的位置整体变化，正文的突变是最直接的信号
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {childList: true, subtree: true, characterData: true});
    host.onConfigChange(() => {
        if (modeOf(host) === "off") {
            clearButtons();
            return;
        }
        schedule();
    });

    schedule();

    return {
        destroy: () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            document.removeEventListener("pointerover", onPointerOver, true);
            document.removeEventListener("pointerout", onPointerOut, true);
            document.removeEventListener("selectionchange", onSelectionChange);
            window.removeEventListener("pointerdown", onButtonPointerDown, true);
            document.removeEventListener("pointerdown", schedule, true);
            window.removeEventListener("scroll", schedule, {capture: true});
            window.removeEventListener("resize", schedule);
            observer.disconnect();
            clearButtons();
        },
    };
};
