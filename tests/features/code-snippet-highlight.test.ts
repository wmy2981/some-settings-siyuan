/**
 * 代码片段编辑区高亮。
 *
 * 实现是「透明 textarea + 底层高亮层」，所以测试要盯住三件事：
 *
 * 1. **两层对齐的前提**：字体 / 内边距 / 边框等一律从 textarea 的计算样式抄过来，
 *    主题自带的 `pre code.hljs { padding: 1em }` 必须被更深的特异性压掉；
 * 2. **安全前提**：只有高亮层真的渲染出内容之后才把输入框文字变透明，等不到
 *    highlight.js（10s）就整体拆掉 —— 绝不留一个看不见字的编辑框；
 * 3. **生命周期**：弹窗每次都新建、里面还能继续加代码片段，所以「发现 / 拆掉 / 重挂」
 *    和输入、滚动、输入法组字都要跟着走，卸载后不留容器与监听。
 *
 * 注意：`highlight.ts` 有模块级状态（hljs 库、样式表只挂一次），
 * 而 `tests/setup.ts` 不会复位它，所以每个用例都 `resetModules()` 后重新 import。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureInstance} from "../../src/core/types";
import definition from "../../src/features/code-snippet-highlight";
import {createHost} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

const HOST_CLASS = "ss-snippet-editor";
const HIGHLIGHT_CLASS = "ss-snippet-editor__highlight";
const INPUT_CLASS = "ss-snippet-editor__input";
const ACTIVE_CLASS = "ss-snippet-editor--active";
const COMPOSING_CLASS = "ss-snippet-editor--composing";

type HighlightModule = typeof import("../../src/features/code-snippet-highlight/highlight");

/** 与其它功能测试同一个思路：rAF 由测试驱动（源码里所有重绘都排在帧回调里）。 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number): void => {
        pending.delete(handle);
    });
    return {
        pendingCount: () => pending.size,
        flush: async (): Promise<void> => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(0));
            await Promise.resolve();
        },
    };
};

const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

/** `ensureHljs().then(...)` 这种链要多让几轮微任务。 */
const flushPromises = async (rounds = 4): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

interface FakeHljs {
    highlight: (code: string, options: {language: string; ignoreIllegals?: boolean;}) => {value: string;};
    getLanguage?: (name: string) => unknown;
}

/** 把 highlight.js 放进 window：内核渲染过代码块时它本来就在那里。 */
const installHljs = (options: {supported?: boolean; throws?: boolean; value?: string;} = {}): FakeHljs => {
    const highlight = vi.fn((code: string) => {
        if (options.throws) {
            throw new Error("hljs boom");
        }
        return {value: options.value ?? `<span class="hljs">${code}</span>`};
    });
    const lib: FakeHljs = {
        highlight,
        getLanguage: () => (options.supported === false ? undefined : {}),
    };
    (window as unknown as {hljs?: FakeHljs;}).hljs = lib;
    return lib;
};

const uninstallHljs = (): void => {
    delete (window as unknown as {hljs?: FakeHljs;}).hljs;
};

interface SnippetFixture {
    dialog: HTMLElement;
    textarea: HTMLTextAreaElement;
}

/** 造一个与内核一样的代码片段弹窗：`[data-key="dialog-snippets"] textarea`。 */
const createSnippetDialog = (options: {value?: string; type?: string;} = {}): SnippetFixture => {
    const dialog = document.createElement("div");
    dialog.setAttribute("data-key", "dialog-snippets");
    const holder = document.createElement("div");
    if (options.type) {
        holder.dataset.type = options.type;
    }
    const textarea = document.createElement("textarea");
    textarea.value = options.value ?? "a { color: red }";
    holder.append(textarea);
    dialog.append(holder);
    document.body.append(dialog);
    return {dialog, textarea};
};

const hostOf = (dialog: HTMLElement): HTMLElement | null => dialog.querySelector<HTMLElement>(`.${HOST_CLASS}`);

describe("代码片段编辑区高亮", () => {
    const mounted: HostHarness[] = [];
    let frames: ReturnType<typeof stubFrames>;
    let mountSnippetHighlight: HighlightModule["mountSnippetHighlight"];

    beforeEach(async () => {
        // 模块级状态（hljs 库 / 样式表只挂一次 / 脚本 Promise）必须逐用例复位，
        // 否则第二个用例起会静默跳过 `ensureStyle()`，断言就变成了假绿
        vi.resetModules();
        ({mountSnippetHighlight} = await import("../../src/features/code-snippet-highlight/highlight"));
        frames = stubFrames();
    });

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
        vi.useRealTimers();
        uninstallHljs();
    });

    const mount = (config: Record<string, unknown> = {}): HostHarness => {
        const harness = createHost(definition, {config: {enabled: true, ...config}});
        const instance: FeatureInstance | void = mountSnippetHighlight(harness.host);
        (harness as unknown as {setInstance: (value: FeatureInstance | undefined) => void;})
            .setInstance(instance || undefined);
        mounted.push(harness);
        return harness;
    };

    it("声明：开关默认关闭，样式每次挂载都重写", () => {
        expect(definition.id).toBe("code-snippet-highlight");
        expect(definition.category).toBe("settings");
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);

        const harness = mount();
        const css = harness.css();
        // 两层必须逐像素对齐：位置、内边距、字体继承，缺一条都会「光标和文字错开」
        expect(css).toContain(`.${HOST_CLASS} {`);
        expect(css).toContain("position: relative;");
        expect(css).toContain(`.${HIGHLIGHT_CLASS} {`);
        expect(css).toContain("position: absolute;");
        expect(css).toContain("pointer-events: none;");
        // 主题里 `pre code.hljs { padding: 1em }` 的特异性更高，必须用更深的选择器 + !important 压掉
        expect(css).toContain(`.${HIGHLIGHT_CLASS} > code.hljs {`);
        expect(css).toContain("padding: 0 !important;");
        expect(css).toContain("background-color: transparent;");
        // 浏览器默认给 code 定死 monospace，光在 pre 上继承不够
        expect(css).toContain(`.${HIGHLIGHT_CLASS} > code {`);
        expect(css).toContain("font: inherit;");
        // 只有渲染成功才藏文字；组字期间把可见性还给输入框
        expect(css).toContain(`.${ACTIVE_CLASS} .${INPUT_CLASS} {`);
        expect(css).toContain("color: transparent;");
        expect(css).toContain(`.${COMPOSING_CLASS} .${INPUT_CLASS} {`);
        expect(css).toContain("--ss-snippet-color");
        expect(harness.styleElement()?.textContent).toBe(css);
    });

    it("把 textarea 包进容器：高亮层在上、输入框在下，结构由内核 DOM 原样保留", () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog({value: "body { color: red }"});
        // 内核的弹窗里 textarea 外面还有一层 holder（data-type 挂在它上面），
        // 容器要插在 holder 里、紧贴 textarea 原来的位置，而不是把 textarea 挪出 holder
        const holder = textarea.parentElement as HTMLElement;

        mount();

        const host = hostOf(dialog);
        const pre = host?.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS}`);
        const code = pre?.querySelector("code");

        expect(host?.parentElement).toBe(holder);
        expect(host?.firstElementChild).toBe(pre);
        expect(host?.lastElementChild).toBe(textarea);
        expect(textarea.parentElement).toBe(host);
        expect(textarea.classList.contains(INPUT_CLASS)).toBe(true);
        expect(pre?.getAttribute("aria-hidden")).toBe("true");
        expect(code?.className).toBe("hljs");
    });

    it("字体、内边距、边框与配色从 textarea 的计算样式抄过来（底色只在挂载时抄一次）", () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog();
        textarea.style.fontSize = "13px";
        textarea.style.paddingLeft = "7px";
        textarea.style.borderTopWidth = "1px";
        textarea.style.color = "rgb(1, 2, 3)";
        textarea.style.backgroundColor = "rgb(4, 5, 6)";

        mount();

        const host = hostOf(dialog) as HTMLElement;
        const pre = host.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS}`) as HTMLElement;
        expect(pre.style.getPropertyValue("font-size")).toBe("13px");
        expect(pre.style.getPropertyValue("padding-left")).toBe("7px");
        // jsdom 不做布局、也不算边框宽度（这里算出来是 0px），所以断言「抄的是计算值」这条契约，
        // 而不是某个具体像素：真机上这里的值就是内核给的边框宽度
        expect(pre.style.getPropertyValue("border-top-width")).toBe(
            window.getComputedStyle(textarea).getPropertyValue("border-top-width"),
        );
        expect(pre.style.getPropertyValue("color")).toBe("rgb(1, 2, 3)");
        expect(pre.style.getPropertyValue("background-color")).toBe("rgb(4, 5, 6)");
        // 组字期间要把这个颜色还给输入框，所以必须留一份在宿主上
        expect(host.style.getPropertyValue("--ss-snippet-color")).toBe("rgb(1, 2, 3)");
    });

    it("data-type 决定语言：css / js / 其余回落到 plaintext", async () => {
        const hljs = installHljs();
        const {textarea} = createSnippetDialog({value: "x", type: "css"});

        mount();
        await flushPromises();

        expect(hljs.highlight).toHaveBeenLastCalledWith("x", {language: "css", ignoreIllegals: true});
        expect(textarea.value).toBe("x");
    });

    it("js 映射到 javascript", async () => {
        const hljs = installHljs();
        createSnippetDialog({value: "let a = 1", type: "js"});

        mount();
        await flushPromises();

        expect(hljs.highlight).toHaveBeenLastCalledWith("let a = 1", {language: "javascript", ignoreIllegals: true});
    });

    it("不在映射表里的 data-type 走 plaintext", async () => {
        const hljs = installHljs();
        createSnippetDialog({value: "print(1)", type: "python"});

        mount();
        await flushPromises();

        expect(hljs.highlight).toHaveBeenLastCalledWith("print(1)", {language: "plaintext", ignoreIllegals: true});
    });

    it("highlight.js 没有该语言时自己转义，不调用 highlight()", async () => {
        const hljs = installHljs({supported: false});
        const {dialog} = createSnippetDialog({value: "a < b & c > d"});

        mount();
        await flushPromises();

        const code = dialog.querySelector("code.hljs") as HTMLElement;
        expect(hljs.highlight).not.toHaveBeenCalled();
        // 不做 HTML 转义就会把代码当标签插进 DOM
        expect(code.innerHTML).toBe("a &lt; b &amp; c &gt; d\n");
    });

    it("highlight() 抛错时回落成纯文本，编辑框仍然可用", async () => {
        installHljs({throws: true});
        const {dialog} = createSnippetDialog({value: "boom"});

        mount();
        await flushPromises();

        const host = hostOf(dialog) as HTMLElement;
        expect(host.querySelector("code.hljs")?.textContent).toBe("boom\n");
        expect(host.classList.contains(ACTIVE_CLASS)).toBe(true);
    });

    it("高亮结果末尾补一个换行，最后一行的行高才和输入框一致", async () => {
        installHljs({value: "<span>x</span>"});
        const {dialog} = createSnippetDialog({value: "x"});

        mount();
        await flushPromises();

        const code = dialog.querySelector("code.hljs") as HTMLElement;
        expect(code.innerHTML).toBe("<span>x</span>\n");
        expect(code.lastChild?.nodeType).toBe(Node.TEXT_NODE);
    });

    it("渲染成功之后才把输入框文字变透明（--active）", async () => {
        installHljs();
        const {dialog} = createSnippetDialog();

        mount();
        const host = hostOf(dialog) as HTMLElement;
        expect(host.classList.contains(ACTIVE_CLASS)).toBe(false);

        await flushPromises();

        expect(host.classList.contains(ACTIVE_CLASS)).toBe(true);
    });

    it("输入事件按帧重渲染", async () => {
        const hljs = installHljs();
        const {textarea} = createSnippetDialog({value: "old"});
        mount();
        await flushPromises();
        // 挂载本身会触发一次 MutationObserver → rAF，先把这一帧跑掉：
        // 否则随后的 input 会被 schedule() 合并进这一帧，而这一帧只负责 scan()
        await frames.flush();

        textarea.value = "new value";
        textarea.dispatchEvent(new Event("input"));
        expect(frames.pendingCount()).toBe(1);
        await frames.flush();

        expect(hljs.highlight).toHaveBeenLastCalledWith("new value", {language: "plaintext", ignoreIllegals: true});
    });

    it("组字期间交还可见性，组字结束后重渲染", async () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog({value: "ni"});
        mount();
        await flushPromises();
        // 同上：先把挂载时那一帧跑掉，compositionend 的 schedule() 才不会被合并
        await frames.flush();
        const host = hostOf(dialog) as HTMLElement;

        textarea.dispatchEvent(new Event("compositionstart"));
        expect(host.classList.contains(COMPOSING_CLASS)).toBe(true);

        textarea.value = "你";
        textarea.dispatchEvent(new Event("compositionend"));
        expect(host.classList.contains(COMPOSING_CLASS)).toBe(false);
        await frames.flush();

        expect(host.querySelector("code.hljs")?.textContent).toBe("你\n");
    });

    it("滚动位置同步给高亮层（两层是同一个滚动视口）", async () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog();
        mount();

        textarea.scrollTop = 42;
        textarea.scrollLeft = 7;
        textarea.dispatchEvent(new Event("scroll"));

        const pre = dialog.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS}`) as HTMLElement;
        expect(pre.scrollTop).toBe(42);
        expect(pre.scrollLeft).toBe(7);
    });

    it("window 上没有 hljs 时按内核同一个地址补两份脚本，加载完成才渲染", async () => {
        const {dialog} = createSnippetDialog({value: "x"});
        mount();

        const hljsScript = document.getElementById("protyleHljsScript") as HTMLScriptElement;
        const thirdScript = document.getElementById("protyleHljsThirdScript") as HTMLScriptElement;
        expect(hljsScript.getAttribute("src")).toBe("/stage/protyle/js/highlight.js/highlight.min.js?v=11.12.0");
        expect(thirdScript.getAttribute("src")).toBe("/stage/protyle/js/highlight.js/third-languages.js?v=2.0.1");
        // 加载期间不能提前把输入框变透明
        expect(hostOf(dialog)?.classList.contains(ACTIVE_CLASS)).toBe(false);

        installHljs();
        hljsScript.dispatchEvent(new Event("load"));
        thirdScript.dispatchEvent(new Event("load"));
        await flushPromises();

        expect(hostOf(dialog)?.classList.contains(ACTIVE_CLASS)).toBe(true);
        expect(hostOf(dialog)?.querySelector("code.hljs")?.textContent).toBe("x\n");
    });

    it("内核已经插过脚本时不重复插入", async () => {
        const pre = document.createElement("script");
        pre.id = "protyleHljsScript";
        const third = document.createElement("script");
        third.id = "protyleHljsThirdScript";
        document.head.append(pre, third);

        createSnippetDialog();
        mount();
        await flushPromises();

        expect(document.querySelectorAll("#protyleHljsScript")).toHaveLength(1);
        expect(document.querySelectorAll("#protyleHljsThirdScript")).toHaveLength(1);
    });

    it("等不到 highlight.js（10s）就整体拆掉，并留下一条日志", async () => {
        vi.useFakeTimers();
        const {dialog, textarea} = createSnippetDialog();
        const harness = mount();
        expect(hostOf(dialog)).not.toBeNull();

        vi.advanceTimersByTime(10000);
        await flushPromises();

        expect(hostOf(dialog)).toBeNull();
        expect(textarea.parentElement).toBe(dialog.firstElementChild);
        expect(textarea.classList.contains(INPUT_CLASS)).toBe(false);
        expect(harness.records.logs.some((args) => String(args[0]).includes("not ready in time"))).toBe(true);
    });

    it("10s 内渲染成功就不会被超时拆掉", async () => {
        vi.useFakeTimers();
        installHljs();
        const {dialog} = createSnippetDialog();
        mount();
        await flushPromises();
        expect(hostOf(dialog)?.classList.contains(ACTIVE_CLASS)).toBe(true);

        vi.advanceTimersByTime(20000);
        await flushPromises();

        expect(hostOf(dialog)).not.toBeNull();
    });

    it("暗色配色取 codeBlockThemeDark，缺失时回落 github-dark", async () => {
        installHljs();
        (window.siyuan.config as unknown as {appearance: unknown;}).appearance = {mode: 1};
        createSnippetDialog();
        mount();
        await flushPromises();

        const link = document.getElementById("protyleHljsStyle") as HTMLLinkElement;
        expect(link.getAttribute("href")).toBe("/stage/protyle/js/highlight.js/styles/github-dark.min.css?v=11.12.0");
    });

    it("亮色配色取 codeBlockThemeLight，缺失时回落 default", async () => {
        installHljs();
        (window.siyuan.config as unknown as {appearance: unknown;}).appearance = {mode: 0};
        createSnippetDialog();
        mount();
        await flushPromises();

        const link = document.getElementById("protyleHljsStyle") as HTMLLinkElement;
        expect(link.getAttribute("href")).toBe("/stage/protyle/js/highlight.js/styles/default.min.css?v=11.12.0");
    });

    it("主题名非法时退回内核默认主题，而不是一直空着", async () => {
        installHljs();
        (window.siyuan.config as unknown as {appearance: unknown;}).appearance = {
            mode: 0,
            codeBlockThemeLight: "不存在的主题",
        };
        createSnippetDialog();
        mount();
        await flushPromises();

        const link = document.getElementById("protyleHljsStyle") as HTMLLinkElement;
        // 配置里给的名字会先按原样挂上去（内核的白名单校验在宿主侧，这里不做二次判断）
        expect(link.getAttribute("href")).toContain("/styles/不存在的主题.min.css");
        // 加载失败后必须退到内核默认主题，而不是一直空着
        link.dispatchEvent(new Event("error"));
        expect(link.getAttribute("href")).toContain("/styles/default.min.css");
    });

    it("内核已经挂好主题样式表时直接复用（同一个元素 id）", async () => {
        installHljs();
        const existing = document.createElement("link");
        existing.id = "protyleHljsStyle";
        existing.rel = "stylesheet";
        existing.setAttribute("href", "/kernel/hljs.css");
        document.head.append(existing);

        createSnippetDialog();
        mount();
        await flushPromises();

        expect(document.querySelectorAll("#protyleHljsStyle")).toHaveLength(1);
        expect(existing.getAttribute("href")).toBe("/kernel/hljs.css");
    });

    it("重复扫描不会给同一个输入框再包一层", async () => {
        installHljs();
        const {dialog} = createSnippetDialog();
        mount();
        expect(dialog.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1);

        document.body.append(document.createElement("span"));
        await settle();
        await frames.flush();

        expect(dialog.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1);
    });

    it("同一个弹窗里的多个代码片段各自独立处理", async () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog();
        const second = document.createElement("textarea");
        second.value = "second";
        textarea.parentElement?.append(second);

        mount();

        expect(dialog.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(2);
        expect(second.classList.contains(INPUT_CLASS)).toBe(true);
    });

    it("弹窗里的其它 textarea（非代码片段）不处理", () => {
        installHljs();
        const textarea = document.createElement("textarea");
        document.body.append(textarea);

        mount();

        expect(document.querySelector(`.${HOST_CLASS}`)).toBeNull();
        expect(textarea.classList.contains(INPUT_CLASS)).toBe(false);
    });

    it("输入框被移出文档后拆掉容器，重新插回会重新挂上", async () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog();
        mount();
        const host = hostOf(dialog) as HTMLElement;

        // 宿主把弹窗内容整块换掉时等效于这一步
        host.remove();
        await settle();
        await frames.flush();
        expect(document.querySelector(`.${HOST_CLASS}`)).toBeNull();

        dialog.append(textarea);
        await settle();
        await frames.flush();

        expect(dialog.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1);
        // 重新挂上时 highlight.js 已经在 window 上，容器会立刻进入 --active，所以只断言宿主类
        expect(textarea.parentElement?.classList.contains(HOST_CLASS)).toBe(true);
    });

    it("卸载把输入框放回原位、移除容器，之后的突变不再重挂", async () => {
        installHljs();
        const {dialog, textarea} = createSnippetDialog();
        const harness = mount();

        harness.dispose();

        expect(dialog.querySelector(`.${HOST_CLASS}`)).toBeNull();
        expect(textarea.parentElement).toBe(dialog.firstElementChild);
        expect(textarea.classList.contains(INPUT_CLASS)).toBe(false);
        expect(harness.styleElement()).toBeNull();

        // 观察器已断开：再插入新的代码片段不会再被包装
        const another = document.createElement("textarea");
        dialog.firstElementChild?.append(another);
        await settle();
        await frames.flush();
        expect(dialog.querySelector(`.${HOST_CLASS}`)).toBeNull();
    });

    it("destroy 幂等：连调两次不抛错，也不会重复拆", () => {
        installHljs();
        createSnippetDialog();
        const harness = mount();

        expect(() => {
            harness.instance?.destroy?.();
            harness.instance?.destroy?.();
        }).not.toThrow();
    });
});
