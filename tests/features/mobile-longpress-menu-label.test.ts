/**
 * 移动端长按菜单补文字。
 *
 * 这一块守的是「按需补、可撤回」两条：
 *
 * - 只补**纯图标**按钮（`textContent` 为空、只写了 `aria-label`）。内核同一个菜单里「更多」
 *   展开的那一行本来就带 `<span>` 文字，补上去会变成重复文字、还会把那一行撑高。
 * - `back`（返回上一层）必须保持纯图标，而且**之前版本补过的话要撤掉** —— 否则那一行会
 *   一直留着文字，看起来像内核自己写坏了。
 *
 * 容器的 `innerHTML` 由内核每次打开菜单时整体重写，所以补文字不是一次性动作：突变观察、
 * 2 秒兜底扫描、`loaded-protyle-static` 事件与配置变更都会重新扫一遍，四路都得能补回来。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/mobile-longpress-menu-label/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";

const CONTAINER_SELECTOR = ".protyle-util--mobile";
const MARK_ATTR = "data-ss-menu-label";

/**
 * 把 `requestAnimationFrame` 换成测试可驱动的队列。
 *
 * 源码把突变触发的重扫排在一帧里（按帧合并，避免内核连续写 DOM 时扫很多遍），
 * 用真实帧只会让断言变成猜时间。
 */
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
            // MutationObserver 的回调排在微任务里，让出一轮再回来
            await Promise.resolve();
        },
    };
};

type Frames = ReturnType<typeof stubFrames>;

/** rAF 与 MutationObserver 互相触发，跑两轮才算把这一屏对完账。 */
const drain = async (frames: Frames): Promise<void> => {
    await frames.flush();
    await frames.flush();
};

const makeContainer = (): HTMLElement => {
    const container = document.createElement("div");
    container.className = "protyle-util--mobile";
    document.body.append(container);
    return container;
};

const actionButton = (action: string, ariaLabel?: string, inner = ""): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "keyboard__action";
    button.setAttribute("data-action", action);
    if (ariaLabel !== undefined) {
        button.setAttribute("aria-label", ariaLabel);
    }
    button.innerHTML = `<svg><use xlink:href="#icon${action}"></use></svg>${inner}`;
    return button;
};

/** 重写容器内容时要造一份真正的按钮标记（内核就是这么写 innerHTML 的）。 */
const markup = (action: string, ariaLabel: string): string =>
    `<button class="keyboard__action" data-action="${action}" aria-label="${ariaLabel}"><svg></svg></button>`;

const labels = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`span[${MARK_ATTR}]`));

const labelTexts = (): string[] => labels().map((span) => span.textContent ?? "");

const mounted: HostHarness[] = [];

const mount = (): HostHarness => {
    const harness = mountFeature(definition);
    mounted.push(harness);
    return harness;
};

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    vi.useRealTimers();
});

describe("移动端长按菜单补文字", () => {
    it("声明：只在移动端交出，分类是外观，默认不启用", () => {
        expect(definition.id).toBe("mobile-longpress-menu-label");
        expect(definition.category).toBe("appearance");
        expect(definition.name).toBe("feature.mobileLongpressMenuLabel.title");
        expect(definition.enabled).toBe(true);
        // 桌面端的长按菜单不是这套 DOM，挂上去只会白扫一遍
        expect(definition.frontends).toEqual(["mobile"]);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });

    it("注入的样式把补过文字的按钮改成「上图下字」的一列，字号与图标尺寸都写死", () => {
        const harness = mount();
        const css = harness.css();

        // 内核的 .keyboard__action 靠 svg 左浮动撑开按钮宽度，不改成 flex 列排版，
        // 补进去的文字会挤到浮动图标右边、把整条工具栏撑乱
        expect(css).toContain(`.keyboard__action[${MARK_ATTR}] {`);
        expect(css).toContain("flex-direction: column");
        expect(css).toContain("flex: none");
        expect(css).toContain(`.keyboard__action[${MARK_ATTR}] > svg`);
        expect(css).toContain("width: 18px");
        expect(css).toContain("height: 18px");
        expect(css).toContain(`span[${MARK_ATTR}]`);
        expect(css).toContain("font-size: 10px");
        expect(css).toContain("line-height: 12px");
    });

    it("纯图标按钮补上 aria-label 的文字，文字排在图标后面", () => {
        const container = makeContainer();
        const copy = actionButton("copy", "复制");
        container.append(copy);

        mount();

        expect(copy.getAttribute(MARK_ATTR)).toBe("true");
        const label = copy.querySelector<HTMLElement>(`span[${MARK_ATTR}]`);
        expect(label?.textContent).toBe("复制");
        // 追加在最后：flex 列里图标在上、文字在下
        expect(copy.lastElementChild).toBe(label);
    });

    it("内核自己给了文字的按钮保持原样（有 span、有裸文本、只有空白都按原样判断）", () => {
        const container = makeContainer();
        const withSpan = actionButton("copyPlainText", "复制为纯文本", "<span>复制为纯文本</span>");
        const withText = actionButton("copyBlockRef", "复制块引用", "复制块引用");
        const blank = actionButton("cut", "剪切", "   ");
        container.append(withSpan, withText, blank);

        mount();

        // 「更多」二级项自带 span 文字，再补一份会变成重复文字
        expect(withSpan.hasAttribute(MARK_ATTR)).toBe(false);
        expect(withSpan.querySelectorAll(`span[${MARK_ATTR}]`)).toHaveLength(0);
        expect(withText.hasAttribute(MARK_ATTR)).toBe(false);
        // 只有空白文本等于没有文字，照补
        expect(blank.getAttribute(MARK_ATTR)).toBe("true");
        expect(blank.querySelector(`span[${MARK_ATTR}]`)?.textContent).toBe("剪切");
    });

    it("没有 aria-label（或只有空白）的按钮不补，避免塞一个空 span", () => {
        const container = makeContainer();
        const nameless = actionButton("unknown");
        const blank = actionButton("unknown", "   ");
        container.append(nameless, blank);

        mount();

        expect(labels()).toHaveLength(0);
        expect(nameless.hasAttribute(MARK_ATTR)).toBe(false);
        expect(blank.hasAttribute(MARK_ATTR)).toBe(false);
    });

    it("「返回上一层」保持纯图标，之前补过的文字要撤掉", () => {
        const container = makeContainer();
        const back = actionButton("back", "返回");
        // 模拟旧版本补过文字后留下的痕迹
        back.setAttribute(MARK_ATTR, "true");
        const stale = document.createElement("span");
        stale.setAttribute(MARK_ATTR, "true");
        stale.textContent = "返回";
        back.append(stale);
        container.append(back);

        mount();

        // 这一行是「更多」的二级导航，与同行的文字项不在一个语义层上，补文字会把整行撑高撑乱
        expect(back.querySelector(`span[${MARK_ATTR}]`)).toBeNull();
        expect(back.hasAttribute(MARK_ATTR)).toBe(false);
    });

    it("重复扫描不会重复补（一个按钮只留一个文字节点）", () => {
        const container = makeContainer();
        const copy = actionButton("copy", "复制");
        container.append(copy);
        const harness = mount();
        expect(labels()).toHaveLength(1);

        harness.emitBus("loaded-protyle-static");
        harness.emitBus("loaded-protyle-static");
        expect(labels()).toHaveLength(1);
        expect(copy.querySelectorAll(`span[${MARK_ATTR}]`)).toHaveLength(1);
    });

    it("只处理长按菜单容器里的按钮，别处的 .keyboard__action 一个都不碰", () => {
        // 桌面端的工具条 / 其它面板也用同一个类名，补上去会串到别的地方
        const outside = document.createElement("div");
        outside.className = "protyle-util";
        const alien = actionButton("copy", "复制");
        outside.append(alien);
        document.body.append(outside);

        const container = makeContainer();
        const inside = actionButton("copy", "复制");
        container.append(inside);

        mount();

        expect(alien.hasAttribute(MARK_ATTR)).toBe(false);
        expect(alien.querySelector(`span[${MARK_ATTR}]`)).toBeNull();
        expect(inside.getAttribute(MARK_ATTR)).toBe("true");
        expect(document.querySelectorAll(CONTAINER_SELECTOR)).toHaveLength(1);
    });

    it("菜单重写 innerHTML 之后，下一帧内把文字补回来", async () => {
        const frames = stubFrames();
        const container = makeContainer();
        container.innerHTML = markup("copy", "复制");
        mount();
        expect(labelTexts()).toEqual(["复制"]);

        // 内核每次打开菜单都整体重写 innerHTML，之前补的 span 一起没了
        container.innerHTML = markup("cut", "剪切");
        await drain(frames);

        expect(labelTexts()).toEqual(["剪切"]);
    });

    it("挂载后才出现的容器由兜底扫描接管，之后的重写也跟着补", async () => {
        vi.useFakeTimers();
        const frames = stubFrames();
        mount();
        expect(labels()).toHaveLength(0);

        // 首次打开长按菜单时容器才被创建：此时没有突变可观察，只能靠定时扫描
        vi.advanceTimersByTime(2000);
        const container = makeContainer();
        container.innerHTML = markup("copy", "复制");
        vi.advanceTimersByTime(2000);
        expect(labelTexts()).toEqual(["复制"]);

        // 这一次扫描同时也把容器纳入突变观察，后续重写不必等 2 秒
        container.innerHTML = markup("paste", "粘贴");
        await drain(frames);
        expect(labelTexts()).toEqual(["粘贴"]);
    });

    it("2 秒兜底扫描自己就是同步的，不依赖帧（帧被卡住时也能补）", () => {
        vi.useFakeTimers();
        // 只装桩不使用：这一条要证明「不靠帧也能补」，所以帧队列必须存在但一直不 flush
        stubFrames();
        const container = makeContainer();
        container.innerHTML = markup("copy", "复制");
        mount();
        expect(labelTexts()).toEqual(["复制"]);

        container.innerHTML = markup("cut", "剪切");
        // 刻意不 flush 帧：这一条能过就说明补文字是定时器自己扫出来的
        vi.advanceTimersByTime(2000);

        expect(labelTexts()).toEqual(["剪切"]);
    });

    it("loaded-protyle-static 事件会立刻重扫（不等帧）", () => {
        const container = makeContainer();
        const harness = mount();
        expect(labels()).toHaveLength(0);

        container.innerHTML = markup("copy", "复制");
        harness.emitBus("loaded-protyle-static");

        expect(labelTexts()).toEqual(["复制"]);
    });

    it("面板保存后重新扫描：登记了配置监听，改动后能补回文字", async () => {
        const frames = stubFrames();
        const container = makeContainer();
        container.innerHTML = markup("copy", "复制");
        const harness = mount();
        expect(harness.records.configListeners).toHaveLength(1);
        expect(harness.records.bus.map((record) => record.type)).toEqual(["loaded-protyle-static"]);

        container.innerHTML = markup("cut", "剪切");
        harness.notifyConfigChange();
        await drain(frames);

        expect(labelTexts()).toEqual(["剪切"]);
    });

    it("destroy 撤掉全部补进去的文字与标记，并停止观察与定时扫描", async () => {
        vi.useFakeTimers();
        const frames = stubFrames();
        const container = makeContainer();
        container.innerHTML = markup("copy", "复制");
        const harness = mount();
        expect(labelTexts()).toEqual(["复制"]);

        harness.dispose();

        // 撤干净：span 与按钮上的标记都不能留在菜单里
        expect(document.querySelectorAll(`span[${MARK_ATTR}]`)).toHaveLength(0);
        expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);

        // 观察者与定时器都停了：再写 DOM、再等 2 秒也不会补
        container.innerHTML = markup("cut", "剪切");
        vi.advanceTimersByTime(2000);
        await drain(frames);
        expect(labels()).toHaveLength(0);
    });

    it("destroy 幂等：重复调用不抛错", () => {
        const harness = mount();
        const instance = harness.instance;
        expect(instance?.destroy).toBeTypeOf("function");
        expect(() => {
            instance?.destroy?.();
            instance?.destroy?.();
        }).not.toThrow();
    });
});
