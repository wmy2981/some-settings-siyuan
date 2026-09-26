/**
 * 移动端块标常显的实现。
 *
 * "正在操作某个块"的判定：
 * - 内核为某个块渲染了块标 → 那个块就是当前操作的块
 * - 手指点到别的块、或者点到编辑器以外 → 这次操作结束，不再强留
 *
 * 强留有个次数上限：一份被反复清掉又搬回去的块标不该无限循环下去，
 * 上限一到就交回内核自己的显隐。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const GUTTER_SELECTOR = ".protyle-gutters";
/** 同一个块的块标最多被搬回去多少次。 */
const MAX_RESTORES = 40;
/** 兜底扫描间隔：新的编辑器（反链、嵌入、搜索预览）会新建自己的 gutter。 */
const RESCAN_INTERVAL_MS = 2000;

interface Pin {
    blockId: string;
    html: string;
    position: string;
    restores: number;
}

export const mountMobileBlockIconAlways = (host: FeatureHost): FeatureInstance => {
    const pins = new Map<HTMLElement, Pin>();
    const observed = new WeakSet<HTMLElement>();
    const observers: MutationObserver[] = [];
    /** 当前正在操作的块；手指点到别处就清空。 */
    let operatedBlockId = "";

    const blockIdOf = (gutter: HTMLElement): string =>
        gutter.querySelector<HTMLElement>("button[data-node-id]")?.dataset.nodeId ?? "";

    const blockExists = (blockId: string): boolean => {
        if (!blockId) {
            return false;
        }
        try {
            return Boolean(document.querySelector(`[data-node-id="${CSS.escape(blockId)}"]`));
        } catch {
            return false;
        }
    };

    const handle = (gutter: HTMLElement) => {
        const hidden = gutter.classList.contains("fn__none") || gutter.innerHTML.trim().length === 0;
        const blockId = blockIdOf(gutter);
        if (!hidden && blockId) {
            // 内核刚渲染了某个块的块标：它就是要操作的那个块
            const previous = pins.get(gutter);
            operatedBlockId = blockId;
            pins.set(gutter, {
                blockId,
                html: gutter.innerHTML,
                position: gutter.style.cssText,
                // 同一份块标被反复搬回去时不清零，否则上限形同虚设
                restores: previous && previous.blockId === blockId ? previous.restores : 0,
            });
            return;
        }
        const pin = pins.get(gutter);
        if (!pin || pin.restores >= MAX_RESTORES) {
            return;
        }
        if (operatedBlockId !== pin.blockId || !blockExists(pin.blockId)) {
            pins.delete(gutter);
            return;
        }
        // 内核把块标收起来了：把刚才那份原样搬回去
        gutter.innerHTML = pin.html;
        gutter.style.cssText = pin.position;
        gutter.classList.remove("fn__none");
        pin.restores += 1;
        host.log(`已恢复块标（第 ${pin.restores} 次，块 ${pin.blockId}）`);
    };

    const scan = () => {
        document.querySelectorAll<HTMLElement>(GUTTER_SELECTOR).forEach((gutter) => {
            if (!observed.has(gutter)) {
                observed.add(gutter);
                const observer = new MutationObserver(() => handle(gutter));
                observer.observe(gutter, {
                    childList: true,
                    attributes: true,
                    attributeFilter: ["class", "style"],
                });
                observers.push(observer);
            }
            handle(gutter);
        });
    };

    const onPointerDown = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        if (target.closest(GUTTER_SELECTOR)) {
            return;
        }
        const blockId = target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? "";
        if (blockId && blockId === operatedBlockId) {
            return;
        }
        // 点到别的块或编辑器以外：这一次操作结束
        operatedBlockId = "";
        pins.clear();
    };

    scan();
    host.addEventBus("loaded-protyle-static", scan);
    document.addEventListener("pointerdown", onPointerDown, true);
    const timer = window.setInterval(scan, RESCAN_INTERVAL_MS);

    return {
        destroy: () => {
            window.clearInterval(timer);
            document.removeEventListener("pointerdown", onPointerDown, true);
            observers.forEach((observer) => observer.disconnect());
            pins.clear();
        },
    };
};
