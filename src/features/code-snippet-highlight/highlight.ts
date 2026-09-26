/**
 * 代码片段编辑区高亮的实现。
 *
 * 三个关键点：
 * 1. 两层对齐靠"把 textarea 的计算样式抄到高亮层上"，而不是靠手写一套近似的
 *    padding / font-size；主题改了、内核调了控件样式，抄一遍就跟着对。
 * 2. highlight.js 与主题样式表都复用思源自己的那份（同一个 URL 与同一个元素 id），
 *    思源已经渲染过代码块时直接用它挂好的 `window.hljs` 与 `#protyleHljsStyle`。
 *    样式表在验证失败（主题名非法）时退回内核默认的 default / github-dark。
 *    ⚠️ 主题样式表里那条 `pre code.hljs { padding: 1em }` 必须按更深的特异性压掉，
 *    否则高亮层整体错开 1em —— 两层对不上，编辑框看起来就是"完全没法用"。
 * 3. 文本只在两层都就绪后才透明；加载失败就整体拆掉，编辑框照旧可用。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DIALOG_KEY = "dialog-snippets";
const TEXTAREA_SELECTOR = `[data-key="${DIALOG_KEY}"] textarea`;
const HOST_CLASS = "ss-snippet-editor";
const HIGHLIGHT_CLASS = `${HOST_CLASS}__highlight`;
const INPUT_CLASS = `${HOST_CLASS}__input`;
const ACTIVE_CLASS = `${HOST_CLASS}--active`;
const SCRIPT_ID = "protyleHljsScript";
const THIRD_SCRIPT_ID = "protyleHljsThirdScript";
const STYLE_ID = "protyleHljsStyle";
/** 与内核 highlightRender.ts 完全相同的资源地址与元素 id：内核加载过就直接复用。 */
const CDN = "/stage/protyle";
const VERSION = "11.12.0";
const THIRD_VERSION = "2.0.1";
const HLJS_URL = `${CDN}/js/highlight.js/highlight.min.js?v=${VERSION}`;
const HLJS_THIRD_URL = `${CDN}/js/highlight.js/third-languages.js?v=${THIRD_VERSION}`;
const STYLE_URL = (name: string): string => `${CDN}/js/highlight.js/styles/${name}.min.css?v=${VERSION}`;
/** 等 highlight.js 的上限；超时就把编辑框还原。 */
const HLJS_TIMEOUT_MS = 10000;

/** 代码片段的 data-type 到 highlight.js 语言名。 */
const LANGUAGES: Record<string, string> = {css: "css", js: "javascript"};

const EDITOR_CSS = `
.${HOST_CLASS} {
    position: relative;
}

.${HOST_CLASS}__highlight {
    position: absolute;
    inset: 0;
    margin: 0;
    overflow: hidden;
    pointer-events: none;
    tab-size: 4;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: normal;
}

.${HOST_CLASS}__highlight code {
    display: block;
    min-height: 100%;
}

/* highlight.js 的主题会给 \`pre code.hljs\` 加 1em 内边距，而它的选择器比这里更深，
   所以必须有 !important + 更高的特异性：不然高亮层整体错开 1em，两层对不上，
   编辑框里的字看起来就是"乱"的。主题自带的底色同样要压掉，否则会盖住编辑框。 */
.${HOST_CLASS}__highlight > code.hljs {
    padding: 0 !important;
    overflow: visible;
    background-color: transparent;
}

/* 只有高亮层渲染成功后才把输入框的文字隐藏，避免出现看不见字的编辑框 */
.${HOST_CLASS}--active .${INPUT_CLASS} {
    position: relative;
    z-index: 1;
    background-color: transparent;
    color: transparent;
    caret-color: var(--b3-theme-on-background);
}

.${HOST_CLASS}--active .${INPUT_CLASS}::selection {
    color: transparent;
    background-color: var(--b3-theme-primary-lightest);
}
`;

interface HighlightLike {
    highlight: (code: string, options: {language: string; ignoreIllegals?: boolean;}) => {value: string;};
    getLanguage?: (name: string) => unknown;
}

interface SiyuanHolder {
    siyuan?: {
        config?: {
            appearance?: {
                mode?: number;
                codeBlockThemeLight?: string;
                codeBlockThemeDark?: string;
            };
        };
    };
}

let highlightLib: HighlightLike | undefined;
let libPromise: Promise<HighlightLike | undefined> | undefined;
let styleAdded = false;

const siyuan = (): SiyuanHolder["siyuan"] => (window as unknown as SiyuanHolder).siyuan;

const loadScript = (src: string, id: string): Promise<void> =>
    new Promise<void>((resolve) => {
        if (document.getElementById(id)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.id = id;
        script.src = src;
        script.async = true;
        script.addEventListener("load", () => resolve(), {once: true});
        // 加载失败也要 resolve，由调用方按"没有 hljs"处理
        script.addEventListener("error", () => resolve(), {once: true});
        document.head.append(script);
    });

/** 复用内核已经挂好的样式表；没有就按当前高亮设置挂一张。 */
const ensureStyle = (): void => {
    if (styleAdded || document.getElementById(STYLE_ID)) {
        return;
    }
    styleAdded = true;
    const appearance = siyuan()?.config?.appearance;
    const dark = appearance?.mode !== 0;
    const preferred = (dark ? appearance?.codeBlockThemeDark : appearance?.codeBlockThemeLight) || "";
    const fallback = dark ? "github-dark" : "default";
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_URL(preferred || fallback);
    // 主题名非法（内核白名单外）时退回默认主题，而不是一直空着
    link.addEventListener("error", () => {
        if (!link.href.includes(`/styles/${fallback}.min.css`)) {
            link.href = STYLE_URL(fallback);
        }
    }, {once: true});
    document.head.append(link);
};

/** 取 highlight.js：内核已经加载过就直接用，否则按内核同一个地址补一份。 */
const ensureHljs = (): Promise<HighlightLike | undefined> => {
    const existing = (window as unknown as {hljs?: HighlightLike;}).hljs;
    if (existing?.highlight) {
        highlightLib = existing;
        return Promise.resolve(existing);
    }
    if (libPromise) {
        return libPromise;
    }
    libPromise = (async () => {
        await Promise.all([
            loadScript(HLJS_URL, SCRIPT_ID),
            loadScript(HLJS_THIRD_URL, THIRD_SCRIPT_ID),
        ]);
        const loaded = (window as unknown as {hljs?: HighlightLike;}).hljs;
        highlightLib = loaded?.highlight ? loaded : undefined;
        return highlightLib;
    })();
    return libPromise;
};

const languageOf = (textarea: HTMLTextAreaElement): string => {
    const kind = textarea.closest<HTMLElement>("[data-type]")?.dataset.type ?? "";
    return LANGUAGES[kind] ?? "plaintext";
};

/** 需要与 textarea 完全一致的那批属性。 */
const MIRRORED = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopStyle",
    "borderBottomStyle",
    "borderRadius",
    "boxSizing",
    "textAlign",
    "textIndent",
    "tabSize",
    "whiteSpace",
    "overflowWrap",
    "wordBreak",
] as const;

interface Attached {
    host: HTMLElement;
    pre: HTMLElement;
    code: HTMLElement;
    onInput: () => void;
    onScroll: () => void;
    timer: number;
}

const toKebab = (value: string): string => value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

export const mountSnippetHighlight = (featureHost: FeatureHost): FeatureInstance => {
    featureHost.addStyle(EDITOR_CSS);
    const attached = new Map<HTMLTextAreaElement, Attached>();
    let frame = 0;

    const render = (textarea: HTMLTextAreaElement, state: Attached) => {
        const lib = highlightLib;
        if (!lib) {
            return false;
        }
        const language = languageOf(textarea);
        const supported = !lib.getLanguage || Boolean(lib.getLanguage(language));
        const value = textarea.value;
        try {
            state.code.innerHTML = supported ?
                lib.highlight(value, {language, ignoreIllegals: true}).value :
                value.replace(/[&<>]/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[char] as string));
        } catch {
            state.code.textContent = value;
        }
        // 末尾补一个换行，最后一行的行高才和输入框一致
        state.code.append(document.createTextNode("\n"));
        state.host.classList.add(ACTIVE_CLASS);
        return true;
    };

    /**
     * 底色与字色只在挂载时抄一次：高亮层生效之后输入框这两项都被我们改成了透明，
     * 再抄一次就会把高亮层也变成透明的（字直接看不见）。
     */
    const paint = (textarea: HTMLTextAreaElement, state: Attached) => {
        const computed = window.getComputedStyle(textarea);
        state.pre.style.setProperty("background-color", computed.getPropertyValue("background-color"));
        state.pre.style.setProperty("color", computed.getPropertyValue("color"));
    };

    const mirror = (textarea: HTMLTextAreaElement, state: Attached) => {
        const computed = window.getComputedStyle(textarea);
        MIRRORED.forEach((key) => {
            const value = computed.getPropertyValue(toKebab(key));
            if (value) {
                state.pre.style.setProperty(toKebab(key), value);
            }
        });
    };

    const attach = (textarea: HTMLTextAreaElement) => {
        if (attached.has(textarea) || !textarea.parentElement) {
            return;
        }
        const host = document.createElement("div");
        host.className = HOST_CLASS;
        const pre = document.createElement("pre");
        pre.className = HIGHLIGHT_CLASS;
        pre.setAttribute("aria-hidden", "true");
        const code = document.createElement("code");
        code.className = "hljs";
        pre.append(code);

        textarea.parentElement.insertBefore(host, textarea);
        host.append(pre, textarea);
        textarea.classList.add(INPUT_CLASS);

        const state: Attached = {
            host,
            pre,
            code,
            timer: 0,
            onInput: () => schedule(),
            onScroll: () => {
                pre.scrollTop = textarea.scrollTop;
                pre.scrollLeft = textarea.scrollLeft;
            },
        };
        attached.set(textarea, state);
        paint(textarea, state);
        mirror(textarea, state);
        textarea.addEventListener("input", state.onInput);
        textarea.addEventListener("scroll", state.onScroll, {passive: true});

        // 加载不出来就彻底拆掉，绝不留一个文字透明的编辑框
        state.timer = window.setTimeout(() => {
            if (!state.host.classList.contains(ACTIVE_CLASS)) {
                detach(textarea);
                featureHost.log("highlight.js 没有按时就绪，已还原代码片段编辑框");
            }
        }, HLJS_TIMEOUT_MS);

        void ensureHljs().then(() => {
            if (!attached.has(textarea)) {
                return;
            }
            ensureStyle();
            render(textarea, state);
        });
    };

    const detach = (textarea: HTMLTextAreaElement) => {
        const state = attached.get(textarea);
        if (!state) {
            return;
        }
        attached.delete(textarea);
        window.clearTimeout(state.timer);
        textarea.removeEventListener("input", state.onInput);
        textarea.removeEventListener("scroll", state.onScroll);
        textarea.classList.remove(INPUT_CLASS);
        state.host.classList.remove(ACTIVE_CLASS);
        state.pre.remove();
        // 把 textarea 放回原来的位置，别留下我们那层容器
        if (state.host.parentElement) {
            state.host.parentElement.insertBefore(textarea, state.host);
        }
        state.host.remove();
    };

    const update = (textarea: HTMLTextAreaElement) => {
        const state = attached.get(textarea);
        if (!state || !textarea.isConnected) {
            return;
        }
        mirror(textarea, state);
        state.onScroll();
        render(textarea, state);
    };

    function schedule() {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            attached.forEach((_state, element) => update(element));
        });
    }

    const scan = () => {
        document.querySelectorAll<HTMLTextAreaElement>(TEXTAREA_SELECTOR).forEach(attach);
        attached.forEach((_state, textarea) => {
            if (!textarea.isConnected) {
                detach(textarea);
            }
        });
    };

    scan();
    // 弹窗每次都是新建的，弹窗里还能继续新增代码片段，所以两者都要观察
    const observer = new MutationObserver(() => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            scan();
        });
    });
    observer.observe(document.body, {childList: true, subtree: true});

    return {
        destroy: () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            [...attached.keys()].forEach((textarea) => detach(textarea));
        },
    };
};
