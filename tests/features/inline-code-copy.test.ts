/**
 * 行内代码复制按钮。
 *
 * 这个功能最容易回归的两件事，就是这些用例主要守的东西：
 *
 * 1. **按下即复制**。表格单元格的富编辑器把「单元格之外的 pointerdown」当成收尾信号，
 *    收到就重建整个单元格 —— 行内代码连同按钮一起消失，而这一切发生在 mouseup 之前，
 *    `click` 根本派发不到按钮上。所以鼠标路径必须走 pointerdown，键盘 / 无障碍那条
 *    （`detail` 为 0 的 click）才走 click，两条不能混、也不能各复制一次。
 * 2. **送进剪贴板的是可见文本**。思源给语义行内元素内部塞了 `\u2060` / `\u200b` 这类
 *    排版用零宽标记，照 `textContent` 复制会静默污染剪贴板：肉眼看不出来，粘进严格输入框就报错。
 *
 * jsdom 里 `getClientRects()` 恒为空、`getBoundingClientRect()` 恒为全 0，而源码正是拿这两个
 * 判断「这段行内代码此刻看不看得见」「按钮该摆在哪」，所以下面用 `layout()` 给具体元素补布局盒
 * （只改该实例，不动原型），并在用例里注明这一点。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureConfig} from "../../src/core/types";
import definition from "../../src/features/inline-code-copy/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

const BUTTON_SELECTOR = ".ss-inline-code-copy";

interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * 把 `requestAnimationFrame` 换成测试可驱动的队列。
 *
 * 源码里所有 DOM 同步都排在帧回调里（滚动、悬停、突变都只是 `schedule()`），用真实帧只会让
 * 断言变成「猜时间」；这里让测试显式决定「这一帧什么时候跑」。
 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    // 取消要按句柄精确删掉：destroy 里取消的是「还没跑的那一帧」，
    // 这里整体清空就测不出它取消的是不是自己那一帧
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number): void => {
        pending.delete(handle);
    });
    return {
        pendingCount: () => pending.size,
        flush: async (): Promise<void> => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(0));
            // MutationObserver 的回调排在微任务里，让出一轮再回来
            await Promise.resolve();
        },
    };
};

type Frames = ReturnType<typeof stubFrames>;

/** rAF 与 MutationObserver 会互相触发，跑两轮才算把这一屏对完账。 */
const drain = async (frames: Frames): Promise<void> => {
    await frames.flush();
    await frames.flush();
};

/** 等复制那条 Promise 链（copyText → then → showMessage）走完。 */
const flushAsync = async (): Promise<void> => {
    for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
    }
};

const rectOf = (box: Box): DOMRect =>
    ({
        left: box.left,
        top: box.top,
        right: box.left + box.width,
        bottom: box.top + box.height,
        width: box.width,
        height: box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
    }) as DOMRect;

/** 给单个元素补布局盒；jsdom 不排版，不补就永远是「没有布局盒」。 */
const layout = (element: HTMLElement, box: Box): void => {
    const value = rectOf(box);
    element.getBoundingClientRect = () => value;
    element.getClientRects = () => [value] as unknown as DOMRectList;
};

const codeSpan = (text: string, box: Box = {left: 100, top: 100, width: 40, height: 20}): HTMLElement => {
    const span = document.createElement("span");
    span.setAttribute("data-type", "code");
    span.textContent = text;
    document.body.append(span);
    layout(span, box);
    return span;
};

const point = (type: string, init: MouseEventInit = {}): MouseEvent =>
    new MouseEvent(type, {bubbles: true, cancelable: true, ...init});

const copyButtons = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTOR));

const setClipboard = (clipboard: unknown): void => {
    Object.defineProperty(navigator, "clipboard", {value: clipboard, configurable: true, writable: true});
};

const clipboardWriter = () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({writeText});
    return writeText;
};

const mounted: HostHarness[] = [];

const mount = (options: {config?: FeatureConfig; i18n?: (key: string) => string;} = {}): HostHarness => {
    const harness = mountFeature(definition, options);
    mounted.push(harness);
    return harness;
};

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    // `navigator.clipboard` / `execCommand` 是这里自己挂上去的，必须自己摘掉：
    // setup 只复位 DOM 与 mockState，不会管它们
    delete (navigator as unknown as {clipboard?: unknown;}).clipboard;
    delete (document as unknown as {execCommand?: unknown;}).execCommand;
});

describe("行内代码复制按钮", () => {
    it("声明：分类是编辑器，开关由 mode 自己表达（没有独立的 enabled 开关）", () => {
        expect(definition.id).toBe("inline-code-copy");
        expect(definition.category).toBe("editor");
        expect(definition.name).toBe("feature.inlineCodeCopy.title");
        expect(definition.enabled).toBe(true);
        expect(definition.frontends).toBeUndefined();

        // 开关就是 mode 的「禁用」选项，再加一个 enabled 开关会让同一个功能有两个开关
        expect(definition.settings).toHaveLength(1);
        expect(definition.settings[0]).toMatchObject({kind: "select", key: "mode", default: "off"});
        expect(definition.isEnabled?.({mode: "off"})).toBe(false);
        expect(definition.isEnabled?.({mode: "hover"})).toBe(true);
        expect(definition.isEnabled?.({mode: "always"})).toBe(true);
    });

    it("注入的样式是 body 上的固定定位小按钮，两个端尺寸一致", () => {
        const harness = mount({config: {mode: "always"}});
        const css = harness.css();

        // 按钮的位置由 JS 按行内代码的 rect 写进 style，所以必须是 fixed
        expect(css).toContain(".ss-inline-code-copy {");
        expect(css).toContain("position: fixed");
        expect(css).toContain("width: 18px");
        expect(css).toContain("height: 18px");
        expect(css).toContain("z-index: 3");
        expect(harness.styleElement()).not.toBeNull();
    });

    it("默认关闭：mode 为 off 或非法值时一个按钮都不建", async () => {
        const frames = stubFrames();
        codeSpan("a");
        codeSpan("b");

        mount();
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);

        // 坏配置不能把按钮挂出来：modeOf 只看 hover / always，其余一律按 off 处理
        const harness = mount({config: {mode: "bogus"}});
        harness.notifyConfigChange();
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("总是显示：每段可见行内代码一个按钮，贴在它右上角", async () => {
        const frames = stubFrames();
        codeSpan("a", {left: 100, top: 100, width: 60, height: 20});
        codeSpan("b", {left: 300, top: 200, width: 40, height: 18});

        mount({config: {mode: "always"}});
        await drain(frames);

        const buttons = copyButtons();
        expect(buttons).toHaveLength(2);
        // left = right - (按钮宽 + 2)，top = top - (按钮高 - 4)，四舍五入成整数像素
        expect(buttons[0].style.left).toBe("140px");
        expect(buttons[0].style.top).toBe("86px");
        expect(buttons[1].style.left).toBe("320px");
        expect(buttons[1].style.top).toBe("186px");
    });

    it("贴边时把按钮压回视口内：右侧不越界，顶部不跑到负坐标", async () => {
        const frames = stubFrames();
        codeSpan("wide", {left: 1000, top: 100, width: 100, height: 20});
        codeSpan("top", {left: 100, top: 5, width: 20, height: 18});

        mount({config: {mode: "always"}});
        await drain(frames);

        const buttons = copyButtons();
        // jsdom 的视口宽 1024：按钮是 fixed，越界的部分点不到，所以夹到 1024 - 18 - 2
        expect(buttons[0].style.left).toBe("1004px");
        expect(buttons[1].style.top).toBe("2px");
    });

    it("视口外与没有高度盒的行内代码不建按钮", async () => {
        const frames = stubFrames();
        // 整段都在视口上方：bottom <= 0
        codeSpan("above", {left: 10, top: -40, width: 30, height: 20});
        // 整段都在视口下方：top >= innerHeight
        codeSpan("below", {left: 10, top: 2000, width: 30, height: 20});
        // 没有高度：rect.height 为 0
        codeSpan("flat", {left: 10, top: 100, width: 30, height: 0});

        mount({config: {mode: "always"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("流式输出与富标题预览里的行内代码不建按钮", async () => {
        const frames = stubFrames();
        const streaming = document.createElement("div");
        streaming.className = "agent-chat__body--streaming";
        streaming.append(codeSpan("live"));
        document.body.append(streaming);

        // 富标题是宿主投影出来的标题 AST，按钮是 fixed 的，会飘在文档树的文字上
        const title = document.createElement("div");
        title.className = "document-title-preview";
        title.append(codeSpan("标题"));
        document.body.append(title);

        const normal = codeSpan("正文");
        expect(normal.isConnected).toBe(true);

        mount({config: {mode: "always"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);
    });

    it("只认正文行内代码：代码块、带 hljs 的 code、正文之外的裸 code 都不算", async () => {
        const frames = stubFrames();
        const typography = document.createElement("div");
        typography.className = "b3-typography";
        document.body.append(typography);

        // 代码块里的 code：:not(pre code) 排掉它
        const pre = document.createElement("pre");
        const blockCode = document.createElement("code");
        blockCode.textContent = "block";
        pre.append(blockCode);
        typography.append(pre);
        layout(blockCode, {left: 10, top: 10, width: 100, height: 20});

        // 已经加上高亮类的 code：:not(.hljs) 排掉它
        const hljs = document.createElement("code");
        hljs.className = "hljs";
        hljs.textContent = "hljs";
        typography.append(hljs);
        layout(hljs, {left: 10, top: 60, width: 100, height: 20});

        // .b3-typography 之外的裸 <code>（设置界面里到处都是）不是正文
        const bare = document.createElement("code");
        bare.textContent = "bare";
        document.body.append(bare);
        layout(bare, {left: 10, top: 110, width: 100, height: 20});

        // 对照：内核直接交给 Lute 渲染的行内代码
        const inline = document.createElement("code");
        inline.textContent = "inline";
        typography.append(inline);
        layout(inline, {left: 10, top: 160, width: 100, height: 20});

        mount({config: {mode: "always"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);
    });

    it("按钮挂在 body 上、标题与 aria-label 走 i18n，图标是 #iconCopy", async () => {
        const frames = stubFrames();
        codeSpan("x");
        mount({config: {mode: "always"}, i18n: (key) => `[${key}]`});
        await drain(frames);

        const button = copyButtons()[0];
        // 不能插进行内代码内部：那是 contenteditable 的内容区，插进去会被内核当正文序列化
        expect(button.parentElement).toBe(document.body);
        expect(button.tagName).toBe("BUTTON");
        expect(button.type).toBe("button");
        expect(button.title).toBe("[feature.inlineCodeCopy.label]");
        expect(button.getAttribute("aria-label")).toBe("[feature.inlineCodeCopy.label]");
        expect(button.innerHTML).toContain("#iconCopy");
    });

    it("同一段行内代码只对应一个按钮，它被宿主摘掉后按钮跟着收", async () => {
        const frames = stubFrames();
        const span = codeSpan("x");
        mount({config: {mode: "always"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);
        const first = copyButtons()[0];

        // 同一段代码再对一次账不能又建一个（buttons 是 span → button 的映射）
        window.dispatchEvent(new Event("resize"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);
        expect(copyButtons()[0]).toBe(first);

        // 宿主重排把这段行内代码摘掉后，按钮不能留在页面上继续悬着
        span.remove();
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("按下即复制（鼠标路径），并提示「已复制」", async () => {
        const frames = stubFrames();
        const writeText = clipboardWriter();
        codeSpan("值");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);

        const button = copyButtons()[0];
        const event = point("pointerdown", {button: 0});
        button.dispatchEvent(event);
        await flushAsync();

        // preventDefault 是为了别让点击把焦点 / 光标从编辑区带走
        expect(event.defaultPrevented).toBe(true);
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith("值");
        expect(harness.records.messages).toEqual(["common.copied"]);
    });

    it("非左键按下不触发复制", async () => {
        const frames = stubFrames();
        const writeText = clipboardWriter();
        codeSpan("值");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);

        const button = copyButtons()[0];
        const event = point("pointerdown", {button: 2});
        button.dispatchEvent(event);
        await flushAsync();

        expect(writeText).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(harness.records.messages).toEqual([]);
    });

    it("键盘 / 无障碍的 click（detail 为 0）也复制，鼠标那次不重复", async () => {
        const frames = stubFrames();
        const writeText = clipboardWriter();
        codeSpan("值");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);

        const button = copyButtons()[0];
        // 鼠标：pointerdown 已经复制过，浏览器随后补发的 click 带 detail >= 1，不能再复制
        button.dispatchEvent(point("pointerdown", {button: 0}));
        await flushAsync();
        button.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
        await flushAsync();
        expect(writeText).toHaveBeenCalledTimes(1);

        // 键盘（Enter / 空格）与无障碍工具派发的是 detail 为 0 的 click，走的是另一条路
        button.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 0}));
        await flushAsync();
        expect(writeText).toHaveBeenCalledTimes(2);
        expect(harness.records.messages).toEqual(["common.copied", "common.copied"]);
    });

    it("复制失败时提示「复制失败」，不把异常抛给调用方", async () => {
        const frames = stubFrames();
        // Clipboard API 被拒 + execCommand 兜底也失败 = 真的没写进去
        setClipboard({
            writeText: vi.fn(async () => {
                throw new Error("denied");
            }),
        });
        (document as unknown as {execCommand: () => boolean;}).execCommand = () => false;

        codeSpan("值");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);

        const button = copyButtons()[0];
        expect(() => button.dispatchEvent(point("pointerdown", {button: 0}))).not.toThrow();
        await flushAsync();

        expect(harness.records.messages).toEqual(["common.copyFailed"]);
    });

    it("复制的是可见文本：零宽标记被剥掉、NBSP 变空格、emoji 的 ZWJ 保留", async () => {
        const frames = stubFrames();
        const writeText = clipboardWriter();
        // 首尾是内核塞的排版标记，中间有 NBSP；\u200d 是 emoji 的连字，不能一起删掉
        codeSpan("\u200b\u2060严格值\u00a0x\u200d😀\u200b\n");
        mount({config: {mode: "always"}});
        await drain(frames);

        copyButtons()[0].dispatchEvent(point("pointerdown", {button: 0}));
        await flushAsync();
        expect(writeText).toHaveBeenCalledWith("严格值 x\u200d😀");
    });

    it("悬浮模式（桌面端）：指到行内代码上才建按钮，离开就收掉", async () => {
        const frames = stubFrames();
        const span = codeSpan("x");
        mount({config: {mode: "hover"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);

        span.dispatchEvent(point("pointerover"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);

        span.dispatchEvent(point("pointerout", {relatedTarget: document.body, clientX: -50, clientY: -50}));
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("悬浮模式：从代码滑向按钮时穿过的那段空隙不算离开", async () => {
        const frames = stubFrames();
        const span = codeSpan("x");
        mount({config: {mode: "hover"}});
        await drain(frames);
        span.dispatchEvent(point("pointerover"));
        await drain(frames);

        // 按钮浮在右上角，指针从代码斜着滑过去会先经过这段空隙；
        // 那一瞬间它「什么都不属于」，但用户并没有离开这段行内代码，按钮不能闪掉
        const button = copyButtons()[0];
        layout(button, {left: 200, top: 200, width: 18, height: 18});
        span.dispatchEvent(point("pointerout", {relatedTarget: document.body, clientX: 222, clientY: 209}));
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);

        // 真的移开（离按钮很远）才收
        span.dispatchEvent(point("pointerout", {relatedTarget: document.body, clientX: 10, clientY: 10}));
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("悬浮模式：指针落在按钮自身上仍算在这一段行内代码里", async () => {
        const frames = stubFrames();
        const span = codeSpan("x");
        mount({config: {mode: "hover"}});
        await drain(frames);
        span.dispatchEvent(point("pointerover"));
        await drain(frames);

        const button = copyButtons()[0];
        // 指针移到按钮上：按钮属于这段行内代码，hovered 不能被清掉
        button.dispatchEvent(point("pointerover"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);

        // relatedTarget 落在按钮里同样不算离开
        span.dispatchEvent(point("pointerout", {relatedTarget: button}));
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);
    });

    it("移动端悬浮模式：光标（selectionchange）落在行内代码上才显示", async () => {
        mockState.frontend = "mobile";
        const frames = stubFrames();
        const span = codeSpan("x");
        mount({config: {mode: "hover"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);

        // 移动端没有 hover，手指点在行内代码上只会落下光标
        const range = document.createRange();
        range.selectNodeContents(span);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);

        selection?.removeAllRanges();
        document.dispatchEvent(new Event("selectionchange"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("桌面端不听 selectionchange（光标进去不该弹按钮）", async () => {
        const frames = stubFrames();
        const span = codeSpan("x");
        mount({config: {mode: "hover"}});
        await drain(frames);

        const range = document.createRange();
        range.selectNodeContents(span);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
    });

    it("移动端：按钮上的按下在 window 捕获阶段就被拦下，宿主收不到这次 pointerdown", async () => {
        mockState.frontend = "mobile";
        const frames = stubFrames();
        const writeText = clipboardWriter();
        codeSpan("值");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);

        // 宿主的收尾监听器在 document 捕获阶段；window 捕获比它更外层。
        // 收不到这一下，单元格就不会重建，承载光标的编辑器与选区都还在
        const hostListener = vi.fn();
        document.addEventListener("pointerdown", hostListener, true);
        const button = copyButtons()[0];
        const event = point("pointerdown", {button: 0, clientX: 110, clientY: 90});
        button.dispatchEvent(event);
        await flushAsync();
        document.removeEventListener("pointerdown", hostListener, true);

        expect(hostListener).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
        // 两条路径不能各复制一次
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(harness.records.messages).toEqual(["common.copied"]);
    });

    it("移动端：按钮之外的按下照旧冒泡给宿主，只用来重新对账", async () => {
        mockState.frontend = "mobile";
        const frames = stubFrames();
        const span = codeSpan("值");
        mount({config: {mode: "always"}});
        await drain(frames);

        const hostListener = vi.fn();
        document.addEventListener("pointerdown", hostListener, true);
        const event = point("pointerdown", {button: 0});
        span.dispatchEvent(event);
        document.removeEventListener("pointerdown", hostListener, true);

        expect(hostListener).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(false);
    });

    it("配置变更：切到 off 立刻收掉按钮，切回 always 重新建出来", async () => {
        const frames = stubFrames();
        codeSpan("x");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);

        // 面板保存后必须立即生效，不需要重载插件
        harness.config.mode = "off";
        harness.notifyConfigChange();
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);

        harness.config.mode = "always";
        harness.notifyConfigChange();
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);
    });

    it("destroy 取消还没执行的那一帧", () => {
        const frames = stubFrames();
        codeSpan("x");
        const harness = mount({config: {mode: "always"}});
        // 挂载后只排了一帧，还没跑过
        expect(frames.pendingCount()).toBe(1);

        harness.dispose();
        expect(frames.pendingCount()).toBe(0);
    });

    it("dispose 之后按钮、样式、监听与观察者都不再响应", async () => {
        const frames = stubFrames();
        codeSpan("x");
        const harness = mount({config: {mode: "always"}});
        await drain(frames);
        expect(copyButtons()).toHaveLength(1);

        harness.dispose();
        expect(copyButtons()).toHaveLength(0);
        expect(harness.styleElement()).toBeNull();

        // 观察者与全部监听都拆掉了：再动 DOM、再悬停都不会重建按钮，也不会再排队帧
        codeSpan("y");
        document.body.dispatchEvent(point("pointerover"));
        window.dispatchEvent(new Event("resize"));
        await drain(frames);
        expect(copyButtons()).toHaveLength(0);
        expect(frames.pendingCount()).toBe(0);
    });
});
