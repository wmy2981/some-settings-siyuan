/**
 * 面板自动聚焦的守护实现。
 *
 * 判据只有一条：**用户在这个弹窗里动过手没有**。
 *
 * - 用户自己在面板里 `pointerdown` / `keydown` 过（点开关、点输入框、按 Tab 换焦点），
 *   之后落在控件上的焦点都是他要的，一律不干预；
 * - 之前没有任何这类事件、却有控件拿到焦点，只可能是打开弹窗时被程序放上去的，
 *   这时把焦点还给弹窗容器（宿主原本的落点，`tabindex="-1"`，不触发软键盘）。
 *
 * 事件都挂在 `document` 的捕获阶段：`pointerdown` 永远早于它引发的那次 `focusin`，
 * 所以"用户点的"和"程序放的"在同一个事件序列里就能分开，不需要计时器，
 * 也不需要判断弹窗刚打开多久。
 */
import type {FeatureInstance} from "../../core/types";
import {PANEL_CLASS} from "../../core/ui";

/** 会被浏览器顺延焦点的控件；按钮和链接的焦点不碍事，不用管。 */
const CONTROL_SELECTOR = "input, select, textarea, [contenteditable]";
/** 面板所在的弹窗容器：必须和 `Dialog` 的落点一致，焦点还给它才等价于"没聚焦"。 */
const CONTAINER_SELECTOR = ".b3-dialog__container";

export const mountPanelNoAutofocus = (): FeatureInstance => {
    /** 已经被用户自己动过的弹窗容器。 */
    const claimed = new WeakSet<HTMLElement>();

    /**
     * 事件落在插件自己的设置弹窗里时返回它的容器，否则返回 undefined。
     *
     * 容器与面板要分别命中：焦点守护认的是容器（焦点最终放哪儿），
     * 而「用户动手了」还包括点弹窗标题栏、点取消/保存按钮 —— 那些节点在容器里但不在面板里。
     */
    const scopeOf = (target: EventTarget | null): HTMLElement | undefined => {
        if (!(target instanceof Element)) {
            return undefined;
        }
        const panel = target.closest<HTMLElement>(`.${PANEL_CLASS}`);
        if (panel) {
            return panel.closest<HTMLElement>(CONTAINER_SELECTOR) ?? undefined;
        }
        const container = target.closest<HTMLElement>(CONTAINER_SELECTOR);
        return container?.querySelector(`.${PANEL_CLASS}`) ? container : undefined;
    };

    const claim = (event: Event) => {
        const scope = scopeOf(event.target);
        if (scope) {
            claimed.add(scope);
        }
    };

    const onFocusIn = (event: FocusEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches(CONTROL_SELECTOR)) {
            return;
        }
        const scope = scopeOf(target);
        if (!scope || claimed.has(scope)) {
            return;
        }
        scope.focus({preventScroll: true});
    };

    document.addEventListener("pointerdown", claim, true);
    document.addEventListener("keydown", claim, true);
    document.addEventListener("focusin", onFocusIn, true);

    return {
        destroy: () => {
            document.removeEventListener("pointerdown", claim, true);
            document.removeEventListener("keydown", claim, true);
            document.removeEventListener("focusin", onFocusIn, true);
        },
    };
};
