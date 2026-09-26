/**
 * 行内代码复制按钮的实现。
 *
 * 一个按钮对应一段行内代码，按需创建、离开视线就移除（始终模式下一次只处理
 * 当前可见的那些）。定位分两趟：先读完所有 rect，再统一写样式，
 * 避免"写一个读一个"把浏览器拖进反复重排。
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

/** 行内代码：data-type 可能带多个值（长文本换行时会加 data-inline-wrap），所以用 ~=。 */
const CODE_SELECTOR = "span[data-type~='code']";
/** 编辑器正文容器。 */
const WYSIWYG_SELECTOR = ".protyle-wysiwyg";
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

export const mountInlineCodeCopy = (host: FeatureHost): FeatureInstance => {
    host.addStyle(COPY_CSS);

    const buttons = new Map<HTMLElement, HTMLButtonElement>();
    let hovered: HTMLElement | undefined;
    let frame = 0;

    const createButton = (span: HTMLElement): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = BUTTON_CLASS;
        button.title = host.i18n("inlineCodeCopy.label");
        button.setAttribute("aria-label", host.i18n("inlineCodeCopy.label"));
        button.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        // 点按钮不能让编辑区失去焦点：移动端那样会收起键盘、丢掉光标，
        // 「悬浮显示」依赖的那个光标一丢，按钮自己就跟着消失了。
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const text = (span.textContent ?? "").replace(/\n$/, "");
            void copyText(text).then((ok) => {
                host.showMessage(ok ? host.i18n("inlineCodeCopy.copied") : host.i18n("inlineCodeCopy.failed"));
            });
        });
        document.body.append(button);
        buttons.set(span, button);
        return button;
    };

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
            const span = element?.closest<HTMLElement>(CODE_SELECTOR);
            if (span) {
                return span;
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
            if (hovered?.isConnected && hovered.closest(WYSIWYG_SELECTOR)) {
                targets.push(hovered);
            }
            if (isMobile()) {
                const focused = focusedCode();
                if (focused && focused.isConnected && focused !== hovered) {
                    targets.push(focused);
                }
            }
            return targets;
        }
        const viewportHeight = window.innerHeight;
        return Array.from(document.querySelectorAll<HTMLElement>(CODE_SELECTOR))
            .filter((span) => span.closest(WYSIWYG_SELECTOR))
            .filter((span) => {
                const rect = span.getBoundingClientRect();
                return rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight;
            });
    };

    const update = () => {
        const targets = visibleCodes();
        const wanted = new Set(targets);
        buttons.forEach((button, span) => {
            if (!wanted.has(span) || !span.isConnected) {
                button.remove();
                buttons.delete(span);
            }
        });
        if (targets.length === 0) {
            return;
        }
        // 先读完，再统一写，避免读写交替触发重排
        const rects = targets.map((span) => span.getBoundingClientRect());
        // 贴边时把按钮压回视口内：按钮是 fixed 定位，落在视口外的部分点不到
        const maxLeft = Math.max(2, window.innerWidth - BUTTON_SIZE - 2);
        targets.forEach((span, index) => {
            const button = buttons.get(span) ?? createButton(span);
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
    const spanOfTarget = (target: Element): HTMLElement | undefined => {
        const span = target.closest<HTMLElement>(CODE_SELECTOR);
        if (span) {
            return span;
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

    const insideOf = (span: HTMLElement, node: Node): boolean =>
        span.contains(node) || Boolean(buttons.get(span)?.contains(node));

    /**
     * 按钮浮在行内代码的右上角，指针从代码滑过去时会先擦过两者之间那一小段空隙，
     * 那一瞬间它在页面上是"什么都不属于"的，不能算离开。
     */
    const nearButtonOf = (span: HTMLElement, event: Event): boolean => {
        const button = buttons.get(span);
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
        const span = spanOfTarget(target);
        if (span === hovered) {
            return;
        }
        if (!span && hovered && nearButtonOf(hovered, event)) {
            return;
        }
        hovered = span;
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
    if (isMobile()) {
        document.addEventListener("selectionchange", onSelectionChange);
    }
    window.addEventListener("scroll", schedule, {capture: true, passive: true});
    window.addEventListener("resize", schedule);
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
            window.removeEventListener("scroll", schedule, {capture: true});
            window.removeEventListener("resize", schedule);
            observer.disconnect();
            clearButtons();
        },
    };
};
