/**
 * 增大提示浮层高度的实现。
 *
 * 同一套浮层既服务 `((` 引用搜索，也服务 `/` 候选、emoji 面板等，
 * 所以效果是"移动端的候选浮层整体变高"——引用搜索正是其中最需要高度的那一个。
 *
 * 内联 `max-height` 由内核反复写入，因此每个元素都要单独观察它的 `style`；
 * 我们只在"比现在更高且不超过可视区"时才改写，写入后条件不再成立，
 * 观察器不会自激。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const HINT_SELECTOR = ".protyle-hint";
const MIN_HEIGHT = 160;
const BOTTOM_GAP = 8;
const RESCAN_INTERVAL_MS = 2000;

interface VisualViewportLike {
    offsetTop?: number;
    height?: number;
}

const ratioOf = (host: FeatureHost): number => {
    const value = Number(host.config.maxHeight);
    if (!Number.isFinite(value)) {
        return 60;
    }
    return Math.min(100, Math.max(20, value));
};

/** 可视区底部：软键盘/键盘工具栏弹起时只有 visualViewport 是可信的。 */
const viewportBottom = (): number => {
    const viewport = (window as unknown as {visualViewport?: VisualViewportLike;}).visualViewport;
    const offsetTop = typeof viewport?.offsetTop === "number" ? viewport.offsetTop : 0;
    const height = typeof viewport?.height === "number" ? viewport.height : window.innerHeight;
    return offsetTop + height;
};

export const mountRefPanelHeight = (host: FeatureHost): FeatureInstance => {
    const observed = new WeakSet<HTMLElement>();
    const observers: MutationObserver[] = [];

    const widen = (element: HTMLElement) => {
        const current = Number.parseFloat(element.style.maxHeight || "0");
        if (!Number.isFinite(current)) {
            return;
        }
        const desired = Math.max(MIN_HEIGHT, window.innerHeight * ratioOf(host) / 100);
        const room = viewportBottom() - element.getBoundingClientRect().top - BOTTOM_GAP;
        const next = Math.min(desired, room);
        if (next > current + 1) {
            element.style.maxHeight = `${Math.round(next)}px`;
        }
    };

    const scan = () => {
        document.querySelectorAll<HTMLElement>(HINT_SELECTOR).forEach((element) => {
            if (observed.has(element)) {
                return;
            }
            observed.add(element);
            const observer = new MutationObserver(() => widen(element));
            observer.observe(element, {attributes: true, attributeFilter: ["style"]});
            observers.push(observer);
            widen(element);
        });
    };

    scan();
    host.addEventBus("loaded-protyle-static", scan);
    const timer = window.setInterval(scan, RESCAN_INTERVAL_MS);

    return {
        destroy: () => {
            window.clearInterval(timer);
            observers.forEach((observer) => observer.disconnect());
        },
    };
};
