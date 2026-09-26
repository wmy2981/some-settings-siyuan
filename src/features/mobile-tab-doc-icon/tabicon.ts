/**
 * 移动端页签默认文档图标样式的实现。
 *
 * 只对"内容就是内核默认 SVG 图标"的图标容器下手：
 * 先把自己上一轮换出来的 emoji 还原成 SVG，再按当前配置决定要不要换成 emoji。
 * 这个顺序让配置在 svg / emoji / follow 之间来回切换时都能立刻还原。
 *
 * ⚠️ 内核在没有图标的页签上渲染的是 `<svg class="mobile-tabs__item-icon">` ——
 * **图标容器本身就是那个 svg**，不是包着 svg 的一层 span。往 `<svg>` 上写
 * `textContent` 只会插一个文本节点，而 SVG 不渲染裸文本，页签于是变成一片空白。
 * 所以这里连同元素一起换掉：换成内核自己给 emoji 图标用的
 * `<span class="mobile-tabs__item-icon">📄</span>`，样式与内核完全对齐。
 *
 * 复检挂在 body 的 childList 上，但每次先做一次 `querySelector` 判断页签概览
 * 是否存在，不存在就直接返回——概览只在用户手动打开时才在 DOM 里。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const ICON_CLASS = "mobile-tabs__item-icon";
const ICON_SELECTOR = `.${ICON_CLASS}`;
const DEFAULT_ICON_USE = "#iconFile";
const MARK = "ss-tab-emoji";
/** 思源对文档的默认 emoji 码点。 */
const FALLBACK_EMOJI = "1f4c4";

/** 内核的默认占位图标，与 `getDocumentIconHTML("", ...)` 的输出一致。 */
const DEFAULT_ICON_HTML = `<svg class="${ICON_CLASS}"><use xlink:href="${DEFAULT_ICON_USE}"></use></svg>`;

interface IconHost {
    siyuan?: {
        config?: {fileTree?: {useSVGDefaultIcon?: boolean;};};
        storage?: Record<string, unknown>;
    };
}

const hostOf = (): IconHost["siyuan"] => (window as unknown as IconHost).siyuan;

/** 外壳设置里"使用 SVG 图标"的取值；缺失时按内核默认（用 SVG）处理。 */
const prefersSvg = (): boolean => hostOf()?.config?.fileTree?.useSVGDefaultIcon !== false;

/** 把码点串还原成字符，解析方式与内核 unicode2Emoji 完全一致。 */
const emojiOf = (): string => {
    const images = hostOf()?.storage?.["local-images"] as {file?: string;} | undefined;
    const code = typeof images?.file === "string" && images.file ? images.file : FALLBACK_EMOJI;
    let emoji = "";
    code.split("-").forEach((part) => {
        try {
            emoji += String.fromCodePoint(Number.parseInt(part.length < 5 ? `0${part}` : part, 16));
        } catch {
            // 码点非法时忽略这一段，保持默认 emoji
        }
    });
    return emoji || String.fromCodePoint(0x1f4c4);
};

/**
 * 这个容器是不是内核的默认占位图标。
 *
 * 容器本身可能就是 `<svg>`，`querySelector("use")` 照样能命中它的子 `<use>`
 * （选择器只在最右侧那一段上受子树限制），所以不需要区分容器是 svg 还是 span。
 */
const isDefaultIcon = (element: HTMLElement): boolean => {
    const use = element.querySelector("use");
    return use?.getAttribute("xlink:href") === DEFAULT_ICON_USE ||
        use?.getAttribute("href") === DEFAULT_ICON_USE;
};

export const mountMobileTabDocIcon = (host: FeatureHost): FeatureInstance => {
    let frame = 0;

    const restore = () => {
        document.querySelectorAll<HTMLElement>(`span.${MARK}`).forEach((element) => {
            element.outerHTML = DEFAULT_ICON_HTML;
        });
    };

    const apply = () => {
        restore();
        const mode = String(host.config.style ?? "follow");
        const wantEmoji = mode === "emoji" || (mode === "follow" && !prefersSvg());
        if (!wantEmoji) {
            return;
        }
        const emoji = emojiOf();
        document.querySelectorAll<HTMLElement>(ICON_SELECTOR).forEach((element) => {
            // 页签自己有 emoji 或自定义图片时不动它
            if (!isDefaultIcon(element)) {
                return;
            }
            const span = document.createElement("span");
            span.className = `${ICON_CLASS} ${MARK}`;
            span.textContent = emoji;
            element.replaceWith(span);
        });
    };

    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            if (!document.querySelector(ICON_SELECTOR)) {
                return;
            }
            // 自己这一趟也会改 DOM，不断开的话观察器会被自己触发，
            // 变成每帧一次的空转。
            observer.disconnect();
            apply();
            observer.observe(document.body, {childList: true, subtree: true});
        });
    };

    const observer = new MutationObserver(schedule);

    schedule();
    host.onConfigChange(schedule);
    observer.observe(document.body, {childList: true, subtree: true});

    return {
        destroy: () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            observer.disconnect();
            restore();
        },
    };
};
