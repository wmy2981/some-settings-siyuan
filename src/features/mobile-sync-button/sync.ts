/**
 * 移动端常显「立即同步」按钮的实现。
 *
 * 为什么不能只写 CSS：`fn__none` 是内核的通用隐藏类，宿主会随时重新加上，
 * 而只要它还在，按钮就是 `display: none`。所以这里走两步：
 * 1. 先按 DOM 结构直接摘掉 `fn__none`；
 * 2. 再用 MutationObserver 盯着这个按钮的 `class`，一旦内核又加回来就再摘一次。
 *
 * 只改这一个属性，不动按钮的其它类、不动兄弟节点。卸载时断开观察并还原初始状态。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 顶栏按钮通常会被分配一个 id，而不是 id 不同就找不到，所以用 id 定位。 */
const SYNC_BUTTON_ID = "toolbarSync";

/** 内核隐藏同步按钮用的通用类。 */
const HIDDEN_CLASS = "fn__none";

export const mountMobileSyncButton = (host: FeatureHost): FeatureInstance => {
    let button: HTMLElement | null = null;
    let observer: MutationObserver | undefined;

    const reveal = (element: HTMLElement) => {
        if (element.classList.contains(HIDDEN_CLASS)) {
            element.classList.remove(HIDDEN_CLASS);
        }
    };

    // 顶栏可能在内核启动完成之后才被创建，所以先尝试一次，再退化为轮询式观察 body。
    button = document.getElementById(SYNC_BUTTON_ID);
    if (button) {
        reveal(button);
    }

    if (button) {
        observer = new MutationObserver(() => reveal(button as HTMLElement));
        observer.observe(button, {attributes: true, attributeFilter: ["class"]});
    } else {
        // 顶栏尚未出现：观察 body，等到按钮被插入时接管，然后停掉定位观察。
        const locator = new MutationObserver(() => {
            const found = document.getElementById(SYNC_BUTTON_ID);
            if (!found) {
                return;
            }
            locator.disconnect();
            button = found;
            reveal(found);
            observer = new MutationObserver(() => reveal(found));
            observer.observe(found, {attributes: true, attributeFilter: ["class"]});
        });
        locator.observe(document.body, {childList: true, subtree: true});
        host.signal.addEventListener("abort", () => locator.disconnect(), {once: true});
    }

    return {
        destroy: () => {
            observer?.disconnect();
        },
    };
};
