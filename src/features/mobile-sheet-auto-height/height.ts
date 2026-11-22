/**
 * 让移动端底部抽屉的高度回到「按内容自适应」。
 *
 * 宿主把面板高度算成 `min(可用高度, 完整视口高 / 2)` 并写成**内联**样式，CSS 追不上，
 * 所以这里逐个面板观察它的 `style`：宿主一重算（内容变化、键盘起落、旋转、抓手拖动），
 * 就把高度改回 `auto`，并按 3.8.11 的规则把上限放到「完整视口高的 56%」。
 *
 * 两条边界不能碰：
 * - 用户已经把抓手拖到全屏（宿主把上限放到了可用高度）时，高度归用户所有，保持原样；
 * - 抽屉正在关闭（`data-dialog-closing`）时宿主已经冻结了高度，再改会让退出动画重排。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 宿主给抽屉面板加的类：底部对话框与独立进度面板都带它。 */
const SHEET_SELECTOR = ".mobile-sheet-panel";
/** 面板外层：宿主在它身上写 top / bottom / 高度，并承担安全区的内边距。 */
const OVERLAY_SELECTOR = ".mobile-sheet-layout";
/** 3.8.11 及以前的标准上限：完整视口高的 56%。 */
const STANDARD_RATIO = 0.56;
const RESCAN_INTERVAL_MS = 2000;

interface MobileSize {
    isLandscape?: boolean;
    landscape?: {height1?: number;};
    portrait?: {height1?: number;};
}

/**
 * 完整视口高度。
 *
 * 软键盘弹起时安卓会压缩 `innerHeight`，宿主用当前方向记录的高度兜底，
 * 这里取同一份值，封顶才不会在键盘弹起期间突然变小。
 */
const fullHeight = (): number => {
    const size = (window.siyuan as unknown as {mobile?: {size?: MobileSize;};})?.mobile?.size;
    const direction = size?.isLandscape ? size.landscape : size?.portrait;
    const recorded = Number(direction?.height1);
    return Math.max(window.innerHeight, Number.isFinite(recorded) ? recorded : 0);
};

/** 面板可用的高度：外层高度减去上下安全区，与宿主的算法一致。 */
const availableHeight = (overlay: HTMLElement): number => {
    const style = getComputedStyle(overlay);
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return Math.max(0, overlay.getBoundingClientRect().height - padding);
};

/** 抽屉是否被用户拖到了全屏：宿主此时把上限放到了可用高度。 */
const isExpanded = (hostMaxHeight: number, available: number, full: number): boolean =>
    Number.isFinite(hostMaxHeight) && hostMaxHeight >= available - 1 && available > full / 2 + 1;

const isClosing = (sheet: HTMLElement): boolean => Boolean(sheet.closest('[data-dialog-closing="true"]'));

/** 内联高度与上限的快照，用来判断宿主是否真的重算过。 */
const signatureOf = (sheet: HTMLElement): string => `${sheet.style.height}|${sheet.style.maxHeight}`;

export const mountMobileSheetAutoHeight = (host: FeatureHost): FeatureInstance => {
    const watchers = new Map<HTMLElement, MutationObserver>();
    const seen = new WeakMap<HTMLElement, string>();

    const fix = (sheet: HTMLElement) => {
        if (!sheet.isConnected || isClosing(sheet)) {
            return;
        }
        // 抓手拖动只改 transform / transition，值没变就不必量尺寸
        if (seen.get(sheet) === signatureOf(sheet)) {
            return;
        }
        const overlay = sheet.closest<HTMLElement>(OVERLAY_SELECTOR);
        if (!overlay) {
            return;
        }
        const full = fullHeight();
        const available = availableHeight(overlay);
        if (isExpanded(Number.parseFloat(sheet.style.maxHeight), available, full)) {
            seen.set(sheet, signatureOf(sheet));
            host.log.info(`kept the expanded height of a sheet (${Math.round(available)}px available)`);
            return;
        }
        const cap = `${Math.round(Math.min(available, full * STANDARD_RATIO))}px`;
        if (sheet.style.height !== "auto") {
            sheet.style.height = "auto";
        }
        if (sheet.style.maxHeight !== cap) {
            sheet.style.maxHeight = cap;
        }
        seen.set(sheet, signatureOf(sheet));
    };

    const track = (sheet: HTMLElement) => {
        if (watchers.has(sheet)) {
            return;
        }
        const observer = new MutationObserver(() => fix(sheet));
        observer.observe(sheet, {attributes: true, attributeFilter: ["style"]});
        watchers.set(sheet, observer);
        fix(sheet);
        host.log.info(
            `fitted a sheet to its content (height ${sheet.style.height}, max-height ${sheet.style.maxHeight})`,
        );
    };

    const scan = () => {
        watchers.forEach((observer, sheet) => {
            if (sheet.isConnected) {
                return;
            }
            observer.disconnect();
            watchers.delete(sheet);
        });
        document.querySelectorAll<HTMLElement>(SHEET_SELECTOR).forEach(track);
    };

    const discover = new MutationObserver((records) => {
        records.forEach((record) => {
            record.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) {
                    return;
                }
                if (node.matches(SHEET_SELECTOR)) {
                    track(node);
                    return;
                }
                node.querySelectorAll<HTMLElement>(SHEET_SELECTOR).forEach(track);
            });
        });
    });

    scan();
    discover.observe(document.body, {childList: true});
    const timer = window.setInterval(scan, RESCAN_INTERVAL_MS);
    host.log.info("mounted: mobile drawers follow their content again");

    return {
        destroy: () => {
            const fitted = watchers.size;
            window.clearInterval(timer);
            discover.disconnect();
            watchers.forEach((observer) => observer.disconnect());
            watchers.clear();
            host.log.info(`unmounted: stopped fitting ${fitted} sheet(s)`);
        },
    };
};
