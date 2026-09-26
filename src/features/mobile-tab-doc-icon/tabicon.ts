/**
 * 移动端页签默认文档图标样式的实现。
 *
 * 只对"内容就是内核默认 SVG 图标"的图标容器下手：
 * 先把自己上一轮换成 emoji 的还原成 SVG，再按当前配置决定要不要换成 emoji。
 * 这个顺序让配置在 svg / emoji / follow 之间来回切换时都能立刻还原。
 *
 * 复检挂在 body 的 childList 上，但每次先做一次 `querySelector` 判断页签概览
 * 是否存在，不存在就直接返回——概览只在用户手动打开时才在 DOM 里。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const ICON_SELECTOR = ".mobile-tabs__item-icon";
const DEFAULT_ICON_USE = "#iconFile";
const MARK = "ss-tab-emoji";
/** 思源对文档的默认 emoji 码点。 */
const FALLBACK_EMOJI = "1f4c4";

const TAB_ICON_CSS = `
.${ICON_SELECTOR}.${MARK} {
    font-size: 16px;
    line-height: 16px;
}
`;

interface IconHost {
    siyuan?: {
        config?: {fileTree?: {useSVGDefaultIcon?: boolean};};
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

const isDefaultIcon = (element: HTMLElement): boolean => {
    const use = element.querySelector("svg use");
    return use?.getAttribute("xlink:href") === DEFAULT_ICON_USE ||
        use?.getAttribute("href") === DEFAULT_ICON_USE;
};

export const mountMobileTabDocIcon = (host: FeatureHost): FeatureInstance => {
    host.addStyle(TAB_ICON_CSS);
    let frame = 0;

    const restore = () => {
        document.querySelectorAll<HTMLElement>(`.${MARK}`).forEach((element) => {
            element.classList.remove(MARK);
            element.innerHTML = `<svg><use xlink:href="${DEFAULT_ICON_USE}"></use></svg>`;
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
            element.classList.add(MARK);
            element.textContent = emoji;
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
            apply();
        });
    };

    schedule();
    host.onConfigChange(schedule);
    const observer = new MutationObserver(schedule);
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
