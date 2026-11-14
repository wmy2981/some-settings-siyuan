/**
 * 用悬浮窗口取代录音提示（recording-window）。
 *
 * 这个功能没有自己的触发入口，全靠「认出内核那条永不消失的录音提示」来驱动，所以测试要守：
 * 1. **识别**：只有带录音文案、且里面有按钮的那条 `#message` 提示才算录音；文案缺失时一个都不认。
 * 2. **切换**：认出后把原生提示藏起来（但**留在 DOM 里** —— 那个按钮是停止录音的唯一入口），
 *    换成自己的浮窗；提示被内核收掉或开始淡出就收窗。
 * 3. **不重复**：同一段录音里连续同步多少次都只能有一个浮窗。
 * 4. **位置与层级**（移动端）：每秒重算底沿，键盘事件时立刻重排并重新抢回层级。
 * 5. **清理**：destroy 收窗、还原原生提示、断开 observer、停掉计时器，且幂等。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/recording-window/index";
import {mountRecordingWindow} from "../../src/features/recording-window/window";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

const RECORDING = "正在录音…";
const STOP_LABEL = "结束录音";

const mounted: HostHarness[] = [];

/** 造宿主环境：`#message` 容器 + 语言包（识别录音靠的就是 `languages.recording` 这段文字）。 */
const setupHost = (): void => {
    window.siyuan.languages.recording = RECORDING;
    window.siyuan.languages.endRecord = STOP_LABEL;
    window.siyuan.zIndex = 7;
    document.body.innerHTML = '<div id="message"></div>';
};

const mount = (): HostHarness => {
    const harness = mountFeature(definition);
    mounted.push(harness);
    return harness;
};

/** 造一条内核风格的提示条。 */
const addToast = (text = RECORDING): {toast: HTMLElement; stop: HTMLButtonElement;} => {
    const toast = document.createElement("div");
    toast.className = "b3-snackbar";
    toast.innerHTML =
        `<div class="b3-snackbar__content">${text}<button class="b3-button" type="button">${STOP_LABEL}</button></div>`;
    document.querySelector("#message")?.append(toast);
    return {toast, stop: toast.querySelector("button") as HTMLButtonElement};
};

/** 把 `requestAnimationFrame` 换成可显式驱动的队列（MutationObserver → sync 都排在帧里）。 */
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
        pending: () => pending.size,
        flush: async (): Promise<void> => {
            // MutationObserver 的回调排在微任务里，而它又会再排一帧；
            // 所以「让出微任务 → 跑一帧」要来回两趟，才能让「先加提示、后同步」这条链跑完
            for (let round = 0; round < 3; round += 1) {
                await Promise.resolve();
                const callbacks = [...pending.values()];
                pending.clear();
                callbacks.forEach((callback) => callback(0));
            }
        },
    };
};

const floating = (): HTMLElement | null => document.querySelector<HTMLElement>(".ss-recording-window");
const timeText = (): string => floating()?.querySelector(".ss-recording-window__time")?.textContent ?? "";
const stopButton = (): HTMLButtonElement | null =>
    floating()?.querySelector<HTMLButtonElement>("[data-ss-stop]") ?? null;

/** jsdom 里所有 `getBoundingClientRect()` 都是 0，要测摆位就得给具体元素补一份。 */
const stubRect = (element: HTMLElement, top: number, height: number): void => {
    element.getBoundingClientRect = () =>
        ({
            top,
            bottom: top + height,
            height,
            width: 100,
            left: 0,
            right: 100,
            x: 0,
            y: top,
            toJSON: () => ({}),
        }) as DOMRect;
};

beforeEach(() => {
    setupHost();
});

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    vi.useRealTimers();
});

describe("用悬浮窗口取代录音提示", () => {
    it("声明里归在「正文编辑」、默认关闭", () => {
        expect(definition.id).toBe("recording-window");
        expect(definition.category).toBe("editor");
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
        expect(definition.mount).toBe(mountRecordingWindow);
    });

    it("没有录音提示时不建窗，也不碰已有 DOM", () => {
        const harness = mount();
        expect(floating()).toBeNull();
        // 只注入了一段样式，其余什么都不该发生
        expect(harness.records.styles).toHaveLength(1);
        expect(harness.css()).toContain(".ss-recording-window__time");
    });

    it("普通提示、以及文案读不到时都不会被当成录音", async () => {
        const frames = stubFrames();
        mount();
        addToast("同步完成");
        await frames.flush();
        expect(floating()).toBeNull();

        // 语言包缺这一段时无从判断「哪个提示是录音」，宁可不认也不能乱认
        window.siyuan.languages.recording = undefined;
        addToast(RECORDING);
        await frames.flush();
        expect(floating()).toBeNull();
    });

    it("认出录音提示后把它藏起来（仍留在 DOM 里），换成自己的浮窗", async () => {
        const frames = stubFrames();
        const harness = mount();
        const {toast, stop} = addToast();

        await frames.flush();
        const windowElement = floating();
        expect(windowElement).not.toBeNull();
        // 原生提示必须留在文档里：它的按钮是内核 stopRecord() 的唯一入口
        expect(toast.isConnected).toBe(true);
        expect(toast.className).toContain("ss-recording-window-native");
        expect(harness.css()).toContain(".ss-recording-window-native");
        expect(harness.css()).toContain("display: none");
        expect(stop.isConnected).toBe(true);

        expect(windowElement?.querySelector(".ss-recording-window__dot")).not.toBeNull();
        expect(windowElement?.querySelector(".ss-recording-window__label")?.textContent).toBe(RECORDING);
        expect(stopButton()?.textContent).toBe(STOP_LABEL);
        // 桌面端不加移动端那个居中类
        expect(windowElement?.className).toBe("ss-recording-window");
        // 一开始就把层级抬到当前之上，免得被其它浮层盖住
        expect(windowElement?.style.zIndex).toBe("8");
    });

    it("时长每秒刷新，跨分钟与跨小时都能正确补位", async () => {
        vi.useFakeTimers();
        const frames = stubFrames();
        mount();
        addToast();
        await frames.flush();

        expect(timeText()).toBe("00:00");
        vi.advanceTimersByTime(1000);
        expect(timeText()).toBe("00:01");
        vi.advanceTimersByTime(64000);
        expect(timeText()).toBe("01:05");
        vi.advanceTimersByTime(3635000);
        expect(timeText()).toBe("1:01:40");
    });

    it("点浮窗上的「结束录音」只是转手去点内核那个按钮，并把自己置灰", async () => {
        const frames = stubFrames();
        mount();
        const {stop} = addToast();
        await frames.flush();

        let clicked = 0;
        stop.addEventListener("click", () => {
            clicked += 1;
        });
        stopButton()?.click();

        // 停止、编码、上传、插入音频块都是内核那条链路的事，插件不能自己动手
        expect(clicked).toBe(1);
        // 置灰是为了避免上传期间被连点第二次
        expect(stopButton()?.disabled).toBe(true);
        expect(floating()).not.toBeNull();
    });

    it("原生提示被收掉或开始淡出时跟着收窗，并停掉计时器", async () => {
        vi.useFakeTimers();
        const clearIntervalSpy = vi.spyOn(window, "clearInterval");
        const frames = stubFrames();
        mount();
        const {toast} = addToast();
        await frames.flush();
        expect(floating()).not.toBeNull();

        toast.classList.add("b3-snackbar--hide");
        await frames.flush();
        expect(floating()).toBeNull();
        // 收窗必须清掉 interval，否则每一秒还会去写一个已经不存在的节点
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });

    it("同一段录音里反复同步也只建一个窗", async () => {
        const frames = stubFrames();
        mount();
        addToast();
        await frames.flush();
        const first = floating();

        // 内核会不停改这条提示（按钮状态、淡出类），每次 DOM 变化都会再同步一遍
        document.querySelector("#message")?.setAttribute("data-x", "1");
        await frames.flush();

        expect(document.querySelectorAll(".ss-recording-window")).toHaveLength(1);
        expect(floating()).toBe(first);
    });

    it("移动端换成居中类，底沿按底部操作条的顶沿抬起", async () => {
        vi.useFakeTimers();
        mockState.frontend = "mobile";
        const frames = stubFrames();
        mount();
        addToast();
        await frames.flush();

        const windowElement = floating();
        expect(windowElement?.className).toBe("ss-recording-window ss-recording-window--mobile");
        // 没有底栏时只留 8px 空隙
        expect(windowElement?.style.bottom).toBe("8px");

        const bar = document.createElement("div");
        bar.id = "mobileBottomBar";
        document.body.append(bar);
        stubRect(bar, 600, 40);
        vi.advanceTimersByTime(1000);
        // 768 - 600 + 8：量的是顶沿而不是高度，否则浮窗会压住底栏小半个身子
        expect(floating()?.style.bottom).toBe("176px");

        // 被 `fn__none` 收起来的底栏不参与计算
        bar.classList.add("fn__none");
        vi.advanceTimersByTime(1000);
        expect(floating()?.style.bottom).toBe("8px");
    });

    it("键盘工具栏出现/收起时立刻重排并重新抢回层级", async () => {
        vi.useFakeTimers();
        mockState.frontend = "mobile";
        const frames = stubFrames();
        const harness = mount();
        addToast();
        await frames.flush();

        const toolbar = document.createElement("div");
        toolbar.id = "keyboardToolbar";
        document.body.append(toolbar);
        stubRect(toolbar, 500, 44);

        harness.emitBus("mobile-keyboard-show");
        // 键盘弹起时工具栏会把自己的层级抬到最高，插件必须重新抬一次才不被盖住
        expect(floating()?.style.zIndex).toBe("9");
        expect(floating()?.style.bottom).toBe("276px");

        toolbar.remove();
        harness.emitBus("mobile-keyboard-hide");
        expect(floating()?.style.bottom).toBe("8px");
    });

    it("destroy 收窗、还原原生提示、断开 observer，且可以重复调用", async () => {
        vi.useFakeTimers();
        const clearIntervalSpy = vi.spyOn(window, "clearInterval");
        const frames = stubFrames();
        const harness = mount();
        const {toast} = addToast();
        await frames.flush();
        expect(floating()).not.toBeNull();

        harness.dispose();
        expect(floating()).toBeNull();
        // 功能被关掉时不能把原生提示永久藏起来，否则用户连停止录音的入口都看不到
        expect(toast.className).not.toContain("ss-recording-window-native");
        expect(toast.isConnected).toBe(true);
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

        // observer 已断开：新的录音提示不再触发建窗
        addToast();
        await frames.flush();
        expect(floating()).toBeNull();

        expect(() => harness.instance?.destroy?.()).not.toThrow();
        expect(harness.styleElement()).toBeNull();
    });
});
