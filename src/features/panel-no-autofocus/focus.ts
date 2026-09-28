/**
 * 面板自动聚焦的守护实现。
 *
 * 判据只有一条：**用户在这个弹窗里动过手没有**。
 *
 * - 用户自己在面板里点过控件、按过键，之后落在控件上的焦点都是他要的，一律不干预；
 * - 之前没有任何这类动作、却有控件拿到焦点，只可能是打开面板时被程序放上去的，
 *   这时把焦点还给弹窗容器（宿主原本的落点，`tabindex="-1"`，不触发软键盘）。
 *
 * 拦截分两层，缺一不可：
 * 1. `focusin`（document 捕获）管同步落点 —— 思源的设置弹窗就是在打开的同一次调用里
 *    把焦点放到侧栏搜索框上的（`initSettingSearch`），这一层必须立刻生效，
 *    否则移动端那一下已经足以顶起软键盘；
 * 2. 面板开着且用户还没动手时，按固定间隔直接查 `document.activeElement` ——
 *    聚焦也可能由动画之后、异步回调或别的地方放上去，不能只等事件。
 *
 * 「用户动过手」的判定：键盘操作一律算（按 Tab 换焦点不能被挡）；鼠标只有落在控件、
 * 控件的标签或按钮上才算 —— 点标题栏、点侧栏分类都不是「要焦点」，之后程序补上的聚焦
 * 照样还回去。
 *
 * 管两处设置面板：本插件自己的面板，以及思源自己的设置弹窗。
 */
import type {FeatureInstance} from "../../core/types";
import {PANEL_CLASS} from "../../core/ui";

/** 会被浏览器顺延焦点的控件；按钮和链接的焦点不碍事，不用管。 */
const CONTROL_SELECTOR = "input, select, textarea, [contenteditable]";
/** 鼠标「冲着某个控件去」的落点：控件自己、它的标签、思源的控件类、按钮。 */
const AIM_SELECTOR = `${CONTROL_SELECTOR}, label, .b3-switch, .b3-select, .b3-text-field, button`;
/** 面板所在的弹窗容器：必须和 `Dialog` 的落点一致，焦点还给它才等价于"没聚焦"。 */
const CONTAINER_SELECTOR = ".b3-dialog__container";
/** 本插件自己的面板。 */
const PANEL_SELECTOR = `.${PANEL_CLASS}`;
/** 思源设置弹窗的内容根。 */
const SETTINGS_PANEL_SELECTOR = ".config__panel";
/** 思源自己的设置弹窗：`openSettingDialog` 会给它的根元素挂上这个 data-key。 */
const SETTINGS_DIALOG_SELECTOR = '[data-key="dialog-setting"]';
/** 兜底巡查的间隔：只查一次 `document.activeElement`，代价可以忽略。 */
const WATCH_INTERVAL_MS = 200;

export const mountPanelNoAutofocus = (): FeatureInstance => {
    /** 已经被用户自己动过的弹窗容器。 */
    const claimed = new WeakSet<HTMLElement>();
    /** 正在盯着的弹窗容器。 */
    const watching = new Set<HTMLElement>();
    let timer = 0;

    /**
     * 元素落在某个设置面板里时返回它的弹窗容器，否则返回 undefined。
     *
     * 容器与面板要分别命中：焦点守护认的是容器（焦点最终放哪儿），
     * 而「用户动手了」还包括点弹窗标题栏、点取消/保存按钮 —— 那些节点在容器里但不在面板里。
     * 思源的设置弹窗反过来：容器在它内部，所以从容器往上找那个 data-key。
     */
    const scopeOf = (element: Element): HTMLElement | undefined => {
        const container = element.closest<HTMLElement>(CONTAINER_SELECTOR);
        if (
            container && (
                container.querySelector(PANEL_SELECTOR) ||
                container.querySelector(SETTINGS_PANEL_SELECTOR) ||
                container.closest(SETTINGS_DIALOG_SELECTOR)
            )
        ) {
            return container;
        }
        // 元素在设置弹窗里、却不在它的容器里（标题栏、遮罩）：容器由弹窗自己给出
        return element.closest<HTMLElement>(SETTINGS_DIALOG_SELECTOR)
            ?.querySelector<HTMLElement>(CONTAINER_SELECTOR) ?? undefined;
    };

    /** 焦点落在没被用户动过的面板控件上时，把它还给弹窗容器。 */
    const guard = (element: Element | null): void => {
        if (!(element instanceof HTMLElement) || !element.matches(CONTROL_SELECTOR)) {
            return;
        }
        const scope = scopeOf(element);
        if (scope && !claimed.has(scope)) {
            scope.focus({preventScroll: true});
        }
    };

    const claim = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        // 键盘一律算用户自己在操作；鼠标只有落在控件（或它的标签、按钮）上才算
        if (event.type === "pointerdown" && !target.closest(AIM_SELECTOR)) {
            return;
        }
        const scope = scopeOf(target);
        if (scope) {
            claimed.add(scope);
        }
    };

    const onFocusIn = (event: FocusEvent) => {
        guard(event.target instanceof Element ? event.target : null);
    };

    /** 巡查：面板还开着、用户还没动手，就把落在控件上的焦点还给容器。 */
    const sweep = () => {
        watching.forEach((scope) => {
            if (!scope.isConnected || claimed.has(scope)) {
                watching.delete(scope);
            }
        });
        guard(document.activeElement);
        if (watching.size === 0 && timer) {
            window.clearInterval(timer);
            timer = 0;
        }
    };

    const watch = (scope: HTMLElement) => {
        watching.add(scope);
        guard(document.activeElement);
        if (!timer) {
            timer = window.setInterval(sweep, WATCH_INTERVAL_MS);
        }
    };

    const observer = new MutationObserver((records) => {
        records.forEach((record) => {
            record.addedNodes.forEach((node) => {
                if (!(node instanceof Element)) {
                    return;
                }
                const scope = node.matches(CONTAINER_SELECTOR) ? node : node.querySelector(CONTAINER_SELECTOR);
                if (scope instanceof HTMLElement) {
                    watch(scope);
                }
            });
        });
    });

    document.addEventListener("pointerdown", claim, true);
    document.addEventListener("keydown", claim, true);
    document.addEventListener("focusin", onFocusIn, true);
    observer.observe(document.body, {childList: true});

    return {
        destroy: () => {
            document.removeEventListener("pointerdown", claim, true);
            document.removeEventListener("keydown", claim, true);
            document.removeEventListener("focusin", onFocusIn, true);
            observer.disconnect();
            watching.clear();
            if (timer) {
                window.clearInterval(timer);
                timer = 0;
            }
        },
    };
};
