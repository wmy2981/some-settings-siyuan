/**
 * 文档树标题行级 Markdown 的挂载。
 *
 * 只改标题那一层文本（`.b3-list-item__text`）的子节点：图标、计数器、`aria-label`
 * 以及 `li` 上的 `data-name` 一律不碰 —— 思源的重命名、拖拽、排序都读 `data-name`，
 * 因此不受影响。
 *
 * 扫描是「有突变才做」的：监听整页的突变，但先判断这次突变是否落在文档树里，
 * 正文输入产生的海量突变在第一次判断时就被挡掉。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {
    MARK_ATTR,
    MARKDOWN_CHARS,
    renderInlineMarkdown,
} from "./markdown";

/** 文档树面板：桌面端是 `.sy__file`，移动端是侧面板里的 `[data-type="sidebar-file"]`。 */
const TREES = [".sy__file", '[data-type="sidebar-file"]'];
const TREE_SELECTOR = TREES.join(", ");

/**
 * 给每个面板各拼一条选择器。
 *
 * 逗号分隔的选择器里，后半截只约束最后一个：`.a, .b .c` 会把 `.a` 自己也算进来。
 * 所以「面板里的某个东西」必须逐个面板写全，不能把面板选择器直接拼在前面。
 */
const inEachTree = (suffix: string): string => TREES.map((tree) => `${tree} ${suffix}`).join(", ");

/** 面板里的标题文本层。 */
const TITLE_SELECTOR = inEachTree(".b3-list-item__text");
/** 已经被我们渲染过的标题：标题层里带着我们的节点。 */
const RENDERED_SELECTOR = inEachTree(`.b3-list-item__text [${MARK_ATTR}]`);
const OBSERVE_OPTIONS: MutationObserverInit = {childList: true, subtree: true, characterData: true};

/**
 * 与大纲树里渲染块内容的写法对齐，色值全部取思源自己的行级主题变量。
 * 行级代码不用管：它挂的是思源自己的 `.fn__code`。
 */
const TITLE_CSS = `
[${MARK_ATTR}="marker"] {
    display: none;
}

[${MARK_ATTR}="strong"] {
    font-weight: bold;
    color: var(--b3-protyle-inline-strong-color);
}

[${MARK_ATTR}="em"] {
    font-style: italic;
    color: var(--b3-protyle-inline-em-color);
}

[${MARK_ATTR}="s"] {
    text-decoration: line-through;
    color: var(--b3-protyle-inline-s-color);
}

[${MARK_ATTR}="mark"] {
    background-color: var(--b3-protyle-inline-mark-background);
    color: var(--b3-protyle-inline-mark-color);
}

[${MARK_ATTR}="sup"],
[${MARK_ATTR}="sub"] {
    position: relative;
    font-size: 75%;
    line-height: 0;
    vertical-align: baseline;
}

[${MARK_ATTR}="sup"] {
    top: -.5em;
}

[${MARK_ATTR}="sub"] {
    bottom: -.25em;
}
`;

export const mountDocTreeTitleMarkdown = (host: FeatureHost): FeatureInstance => {
    host.addStyle(TITLE_CSS);

    let frame = 0;
    /** 每个标题按哪一份原文渲染过。重命名会让原文变化，那时才重建节点。 */
    const rendered = new WeakMap<HTMLElement, string>();

    const sync = (title: HTMLElement) => {
        // 定界符留在 DOM 里，所以 textContent 始终是原文，不需要另存一份
        const source = title.textContent ?? "";
        if (!MARKDOWN_CHARS.test(source) || rendered.get(title) === source) {
            return;
        }
        rendered.set(title, source);
        title.replaceChildren(...renderInlineMarkdown(source));
    };

    /**
     * 这次突变是否值得扫一遍文档树。
     *
     * 正文输入会派发海量 childList / characterData，但它们的目标与新增节点都不在
     * 文档树里，第一次判断就被挡掉；真正要处理的只有重命名（改写标题的 innerHTML）、
     * 笔记增删、展开折叠后重建的子树，以及文档树面板自己被创建出来。
     */
    const worthScanning = (records: MutationRecord[]): boolean => {
        for (const record of records) {
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            if (target?.closest(TREE_SELECTOR)) {
                return true;
            }
            for (const node of record.addedNodes) {
                if (node instanceof Element && node.closest(TREE_SELECTOR)) {
                    return true;
                }
            }
        }
        return false;
    };

    const scan = () => {
        // 自己写 DOM 前先断开，否则每一次写入都会再触发自己
        observer.disconnect();
        document.querySelectorAll<HTMLElement>(TITLE_SELECTOR).forEach(sync);
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

    observer.observe(document.body, OBSERVE_OPTIONS);
    scan();

    return {
        destroy: () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            // 还原成内核写入的纯文本；定界符本来就在，取 textContent 即可
            document.querySelectorAll<HTMLElement>(RENDERED_SELECTOR).forEach((node) => {
                const title = node.parentElement;
                if (title) {
                    const text = title.textContent ?? "";
                    title.textContent = text;
                }
            });
        },
    };
};
