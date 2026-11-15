/**
 * 智能体思考标题固定在顶部。
 *
 * 这个功能分两半，测试也分两半：
 *
 * 1. **CSS**（`style.ts`）：吸顶位置、层级、底色，以及「只有一条规则、不加 `!important`」。
 *    `top` 是负的那个 12px 不是笔误 —— 粘性定位参照的是滚动容器的内容盒，
 *    而它自带 `padding-top`，写成 0 会在面板顶部漏出一条缝（见源码注释）。
 *    另外每次挂载都必须**重写**同一张 `<style>`：禁用 / 重载插件都不会重载页面，
 *    元素在时直接 return 会留下旧样式表（development.md 的「样式」一节）。
 * 2. **滚动**（`scroll.ts`）：折叠后只在「卡片整个滑到上沿之上」时把顶沿对回去。
 *    其余情况一律不碰滚动位置 —— 替用户猜停在哪比不帮忙更糟。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureInstance} from "../../src/core/types";
import definition from "../../src/features/agent-thinking-sticky-header/index";
import {anchorThinkingCard} from "../../src/features/agent-thinking-sticky-header/scroll";
import {mountAgentThinkingStickyHeader} from "../../src/features/agent-thinking-sticky-header/style";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

/** jsdom 不做布局，`getBoundingClientRect()` 全是 0，几何断言只能自己喂。 */
const rect = (top: number, bottom: number): DOMRect =>
    ({
        top,
        bottom,
        left: 0,
        right: 0,
        width: 0,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
    }) as DOMRect;

/**
 * 把 `requestAnimationFrame` 换成可驱动的队列。
 *
 * 源码在点击后先排一帧、再排一个 240ms 的定时器；用真实的帧与真实的时间只会让断言
 * 变成「猜多久」，所以这里让测试显式决定「这一帧什么时候跑」。
 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    return {
        pendingCount: () => pending.size,
        flush: (): void => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(0));
        },
    };
};

interface SceneOptions {
    /** 卡片顶沿（相对视口）。 */
    cardTop: number;
    /** 卡片底沿。它是否已经越过滚动区上沿，决定要不要动滚动位置。 */
    cardBottom: number;
    scrollerTop?: number;
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
}

/** 造一条站在滚动区里的思考卡片。 */
const buildScene = (options: SceneOptions) => {
    const scroller = document.createElement("div");
    scroller.className = "agent-chat__messages";
    scroller.style.overflowY = "auto";
    const card = document.createElement("div");
    card.className = "agent-chat__msg--thinking";
    const header = document.createElement("div");
    header.className = "agent-chat__thinking-header";
    const label = document.createElement("span");
    label.textContent = "已思考 3 秒";
    header.append(label);
    const body = document.createElement("div");
    body.className = "agent-chat__thinking-body";
    card.append(header, body);
    scroller.append(card);
    document.body.append(scroller);

    Object.defineProperty(scroller, "scrollHeight", {
        value: options.scrollHeight ?? 1000,
        configurable: true,
    });
    Object.defineProperty(scroller, "clientHeight", {
        value: options.clientHeight ?? 300,
        configurable: true,
    });
    scroller.scrollTop = options.scrollTop ?? 0;

    const scrollerTop = options.scrollerTop ?? 0;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(rect(options.cardTop, options.cardBottom));
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(scrollerTop, scrollerTop + 300));

    return {scroller, card, header, label, body};
};

const click = (element: Element): void => {
    element.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
};

/** 该功能注入的 `<style>` 是否唯一：重复挂载不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="agent-thinking-sticky-header"]').length;

describe("智能体思考标题固定在顶部", () => {
    const harnesses: HostHarness[] = [];
    const stops: (() => void)[] = [];
    const frames = () => stubFrames();

    const mount = (): HostHarness => {
        const harness = mountFeature(definition);
        harnesses.push(harness);
        return harness;
    };

    const anchor = (): () => void => {
        const stop = anchorThinkingCard();
        stops.push(stop);
        return stop;
    };

    afterEach(() => {
        harnesses.splice(0).forEach((harness) => harness.dispose());
        stops.splice(0).forEach((stop) => stop());
        vi.useRealTimers();
    });

    it("声明：只支持到 3.8.10-alpha.1（上游从下一个版本起自己实现了）", () => {
        expect(definition.id).toBe("agent-thinking-sticky-header");
        expect(definition.category).toBe("ai");
        expect(definition.enabled).toBe(true);
        // 版本上限是闭区间：写到上游实现的前一个版本为止
        expect(definition.maxAppVersion).toBe("3.8.10-alpha.1");
        expect(definition.minAppVersion).toBeUndefined();
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });

    it("注入一条规则：粘性定位 + 负的 top 抹掉滚动区的内边距 + 底色与层级", () => {
        const harness = mount();
        const css = harness.css();

        expect(css).toContain(".agent-chat__thinking-header {");
        expect(css).toContain("position: sticky;");
        // 负 12px 与 .agent-chat__messages 的 padding-top 对应：取 0 会在面板顶部漏一条缝
        expect(css).toContain("top: -12px;");
        // 正文有 contain: layout paint（自带层叠上下文），标题必须用正数压住它
        expect(css).toContain("z-index: 2;");
        // 浮在正文之上，没有底色就会和滚过去的思考内容叠字
        expect(css).toContain("background-color: var(--b3-theme-background);");
        // 只有一条规则，不做任何宿主没有声明的属性覆盖
        expect(css.match(/\{/g)).toHaveLength(1);
        expect(css).not.toContain("!important");
        expect(styleCount()).toBe(1);
        expect(harness.styleElement()?.textContent).toBe(harness.records.styles[0]);
    });

    it("选择器不加限定层级：停靠面板与编辑器内 AI 面板共用同一套类名", () => {
        const css = mount().css().replace(/\/\*[\s\S]*?\*\//g, "").trim();
        const selector = css.slice(0, css.indexOf("{")).trim();

        // 多套一层（例如要求它是停靠面板的子节点）会让编辑器里的 AI 面板失效
        expect(selector.startsWith(".agent-chat__thinking-header")).toBe(true);
        expect(selector).not.toContain("#");
        expect(selector).not.toContain(" ");
    });

    it("移动端与桌面端注入同一份 CSS（单条规则两端共用）", () => {
        const desktop = mount().css();
        harnesses.splice(0).forEach((harness) => harness.dispose());
        // 源码不按前端分支，两端必须是同一份，而不是「桌面生效、移动端漏了」
        expect(desktop).toBe(mount().css());
    });

    it("重新挂载（保存配置后宿主重新挂载）时重写同一张样式表，不堆叠第二张", () => {
        mount();
        expect(styleCount()).toBe(1);
        const first = document.head.querySelector<HTMLStyleElement>(
            'style[data-some-settings-style="agent-thinking-sticky-header"]',
        );

        const second = mount();

        // 元素还在时直接 return 会留下旧样式表：只有整页刷新才恢复（development.md 的「样式」一节）
        expect(styleCount()).toBe(1);
        expect(document.head.querySelector<HTMLStyleElement>(
            'style[data-some-settings-style="agent-thinking-sticky-header"]',
        )).toBe(first);
        expect(second.records.styles).toHaveLength(1);
        expect(first?.textContent).toBe(second.records.styles[0]);
    });

    it("卸载后样式元素与点击监听一起收干净", () => {
        const harness = mount();
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        const frame = frames();
        expect(harness.styleElement()).not.toBeNull();

        harness.dispose();
        click(scene.header);
        frame.flush();

        expect(harness.styleElement()).toBeNull();
        expect(document.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
        expect(frame.pendingCount()).toBe(0);
        expect(scene.scroller.scrollTop).toBe(100);
    });

    it("卸载幂等：重复释放不抛错", () => {
        const harness = mount();
        harness.dispose();
        expect(() => harness.dispose()).not.toThrow();
    });

    it("折叠后卡片整个滑到上沿之上：把顶沿对回滚动区上沿", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        anchor();
        const frame = frames();

        click(scene.header);
        frame.flush();

        // 100 + (-40) - 0 = 60：标题重新贴住面板顶部，输出段落落在它下面
        expect(scene.scroller.scrollTop).toBe(60);
    });

    it("过渡结束后再看一眼：240ms 后按当时的高度再对齐一次", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        const spy = vi.spyOn(scene.card, "getBoundingClientRect");
        anchor();
        const frame = frames();
        spy.mockClear();

        click(scene.header);
        frame.flush();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(scene.scroller.scrollTop).toBe(60);

        // 折叠动画期间高度一帧一帧地变，所以定时器到点后要再对一次
        vi.advanceTimersByTime(240);
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it("卡片底沿还在上沿之下时不动滚动位置：卡片自己就是用户的参照物", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: 120, cardBottom: 900, scrollTop: 60});
        anchor();
        const frame = frames();

        click(scene.header);
        frame.flush();
        vi.advanceTimersByTime(240);

        expect(scene.scroller.scrollTop).toBe(60);
    });

    it("卡片底沿正好等于上沿（边界）时仍然对齐", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -30, cardBottom: 0, scrollTop: 100});
        anchor();
        const frame = frames();

        click(scene.header);
        frame.flush();

        // 判断用的是「底沿是否已经在上沿之上」，相等属于已经越过去
        expect(scene.scroller.scrollTop).toBe(70);
    });

    it("滚动位置不会被算成负数：已经在上沿之上、scrollTop 也是 0 时保持 0", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -30, cardBottom: -10, scrollTop: 0});
        anchor();
        const frame = frames();

        click(scene.header);
        frame.flush();

        expect(scene.scroller.scrollTop).toBe(0);
    });

    it("点在标题里的文字上也生效（整行可点）", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        anchor();
        const frame = frames();

        click(scene.label);
        frame.flush();

        expect(scene.scroller.scrollTop).toBe(60);
    });

    it("点思考正文不触发对齐：只有标题是折叠开关", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        anchor();
        const frame = frames();

        click(scene.body);
        frame.flush();
        vi.advanceTimersByTime(240);

        expect(frame.pendingCount()).toBe(0);
        expect(scene.scroller.scrollTop).toBe(100);
    });

    it("标题不在思考卡片里（重试卡片用另一套类名）时完全不介入", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        const retry = document.createElement("div");
        retry.className = "agent-chat__msg--retry";
        retry.innerHTML = '<div class="agent-chat__thinking-header">失败</div>';
        scene.scroller.append(retry);
        anchor();
        const frame = frames();

        click(retry.firstElementChild as Element);

        expect(frame.pendingCount()).toBe(0);
        expect(scene.scroller.scrollTop).toBe(100);
    });

    it("没有滚动祖先时安全返回，不碰任何滚动位置", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const card = document.createElement("div");
        card.className = "agent-chat__msg--thinking";
        card.innerHTML = '<div class="agent-chat__thinking-header">已思考</div>';
        document.body.append(card);
        anchor();
        const frame = frames();

        // 编辑器内的 AI 面板用自己的局部滚动区，没有滚动祖先的地方吸顶不该有副作用
        expect(() => {
            click(card.firstElementChild as Element);
            frame.flush();
            vi.advanceTimersByTime(240);
        }).not.toThrow();
    });

    it("定时器到点前卡片已被移除：不读已脱离文档的节点", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        const spy = vi.spyOn(scene.card, "getBoundingClientRect");
        anchor();
        const frame = frames();
        spy.mockClear();

        click(scene.header);
        scene.card.remove();
        frame.flush();
        vi.advanceTimersByTime(240);

        // 卡片切走（换会话）后还去量它、甚至改滚动位置，只会把新会话的视图弄乱
        expect(spy).not.toHaveBeenCalled();
        expect(scene.scroller.scrollTop).toBe(100);
    });

    it("连点两次只保留最后一个定时器：不会在 240ms 后连做两次无关的对齐", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: -40, cardBottom: -10, scrollTop: 100});
        const spy = vi.spyOn(scene.card, "getBoundingClientRect");
        anchor();
        const frame = frames();
        spy.mockClear();

        click(scene.header);
        click(scene.header);
        frame.flush();
        expect(spy).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(240);

        // 两次点击的立即对齐 + 只该剩一个的延后对齐 = 3 次；第一次的定时器若没清就是 4 次
        expect(spy).toHaveBeenCalledTimes(3);
    });

    it("stop() 之后不再响应，未到点的定时器也被清掉", () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        const scene = buildScene({cardTop: 100, cardBottom: 400, scrollTop: 60});
        const spy = vi.spyOn(scene.card, "getBoundingClientRect");
        const stop = anchor();
        const frame = frames();

        click(scene.header);
        frame.flush();
        stop();
        spy.mockClear();

        click(scene.header);
        vi.advanceTimersByTime(240);

        expect(frame.pendingCount()).toBe(0);
        expect(spy).not.toHaveBeenCalled();
        expect(scene.scroller.scrollTop).toBe(60);
    });

    it("直接调用 mount 也返回带 destroy 的实例", () => {
        const instance: FeatureInstance = mountAgentThinkingStickyHeader(
            {
                addStyle: () => () => undefined,
            } as unknown as Parameters<typeof mountAgentThinkingStickyHeader>[0],
        );

        expect(typeof instance.destroy).toBe("function");
        expect(() => instance.destroy?.()).not.toThrow();
        expect(() => instance.destroy?.()).not.toThrow();
    });
});
