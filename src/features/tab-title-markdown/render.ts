/**
 * 页签标题的行级 Markdown 渲染。
 *
 * 内核给页签写标题永远是纯文本（`Tab.updateTitle()` 直接 `innerHTML = escapeHtml(title)`），
 * 所以这里和文档树标题同一套做法：只换那层文字节点的子节点，定界符留在 DOM 里由 CSS 隐藏，
 * 于是 `.textContent` 始终等于原文 —— 内核把页签文字读出去的地方（页签下拉列表的文字、
 * `document.title`、拖拽载荷）看到的仍是原本那份标题。
 *
 * 页签标题一共有三处：
 * - 桌面端页签条：`li.item[data-type="tab-header"] > .item__text`
 * - 桌面端页签下拉列表：它的文字是在菜单构建时从上面那个元素抄过去的，所以要单独渲染一遍
 * - 移动端页签概览（底部抽屉）：`.mobile-tabs__item-title`
 *
 * 选择器刻意带足限定条件：思源里用 `.layout-tab-bar` + `.item__text` 的地方不止页签条一处
 * （设置、数据历史、集市里都有自己的小页签），那些地方的文字不属于本功能。
 *
 * 扫描与文档树标题同构：监听整页突变，但先判断这次突变是否落在这三处容器里，
 * 正文输入产生的海量突变在第一次判断时就被挡掉。
 */
import {
    INLINE_MARKDOWN_CSS,
    MARK_ATTR,
    MARKDOWN_CHARS,
    renderInlineMarkdown,
} from "../../core/inline-markdown";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 桌面端页签条里的标题层。 */
const TAB_TITLE_SELECTOR = 'ul.layout-tab-bar > li.item[data-type="tab-header"] > .item__text';
/** 桌面端页签下拉列表（`Constants.MENU_TAB_LIST`）里的文字层。 */
const TAB_LIST_SELECTOR = '[data-name="tabList"] .b3-menu__label';
/** 移动端页签概览里的标题层。 */
const MOBILE_TITLE_SELECTOR = ".mobile-tabs .mobile-tabs__item-title";

/**
 * 会承载上述文字层的容器。
 *
 * 只用来快速排除「这次突变显然无关」：真正决定改不改 DOM 的是上面那几条精确选择器，
 * 所以这里宁可写宽一点（菜单容器用 `.b3-menu`，不依赖某个具体 id）。
 */
const CONTAINER_SELECTOR = "ul.layout-tab-bar, .b3-menu, .mobile-tabs";
const OBSERVE_OPTIONS: MutationObserverInit = {childList: true, subtree: true, characterData: true};

export const mountTabTitleMarkdown = (host: FeatureHost): FeatureInstance => {
    host.addStyle(INLINE_MARKDOWN_CSS);

    let frame = 0;
    /** 每个文字层按哪一份原文渲染过；重命名会让原文变化，那时才重建节点。 */
    let rendered = new WeakMap<HTMLElement, string>();
    let targetSelector = "";
    let renderedSelector = "";

    /** 按当前 scope 决定要处理哪几处文字层。选项本身就是这个功能的开关。 */
    const applyScope = () => {
        const scope = String(host.config.scope ?? "disabled");
        const targets: string[] = [];
        if (scope === "desktop" || scope === "both") {
            targets.push(TAB_TITLE_SELECTOR, TAB_LIST_SELECTOR);
        }
        if (scope === "mobile" || scope === "both") {
            targets.push(MOBILE_TITLE_SELECTOR);
        }
        targetSelector = targets.join(", ");
        renderedSelector = targets.map((target) => `${target} [${MARK_ATTR}]`).join(", ");
    };

    const sync = (element: HTMLElement) => {
        // 定界符留在 DOM 里，所以 textContent 始终是原文，不需要另存一份
        const source = element.textContent ?? "";
        if (!MARKDOWN_CHARS.test(source) || rendered.get(element) === source) {
            return;
        }
        rendered.set(element, source);
        element.replaceChildren(...renderInlineMarkdown(source));
    };

    /** 还原成内核写入的纯文本；定界符本来就在，取 textContent 即可。 */
    const restore = () => {
        if (renderedSelector) {
            document.querySelectorAll<HTMLElement>(renderedSelector).forEach((node) => {
                const parent = node.parentElement;
                if (parent) {
                    parent.textContent = parent.textContent ?? "";
                }
            });
        }
        // 还原之后 DOM 里已经没有我们的节点了，记录必须一起清掉，否则不会再渲染
        rendered = new WeakMap<HTMLElement, string>();
    };

    const worthScanning = (records: MutationRecord[]): boolean => {
        for (const record of records) {
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            if (target?.closest(CONTAINER_SELECTOR)) {
                return true;
            }
            for (const node of record.addedNodes) {
                if (node instanceof Element && node.closest(CONTAINER_SELECTOR)) {
                    return true;
                }
            }
        }
        return false;
    };

    const scan = () => {
        // 自己写 DOM 前先断开，否则每一次写入都会再触发自己
        observer.disconnect();
        if (targetSelector) {
            document.querySelectorAll<HTMLElement>(targetSelector).forEach(sync);
        }
        observer.observe(document.body, OBSERVE_OPTIONS);
    };

    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            scan();
        });
    };

    const observer = new MutationObserver((records) => {
        if (worthScanning(records)) {
            schedule();
        }
    });

    applyScope();
    observer.observe(document.body, OBSERVE_OPTIONS);
    scan();
    // 换了适用端就地改：先还原上一次渲染过的地方，再按新的选择器重扫
    host.onConfigChange(() => {
        restore();
        applyScope();
        schedule();
    });

    return {
        destroy: () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            restore();
        },
    };
};
