/**
 * 移动端常显「立即同步」按钮（`mobile-sync-button`）的单元测试。
 *
 * 这个功能只跟一个类名打交道：`fn__none`。所以要覆盖的其实是四个时机 ——
 * 挂载时按钮在、挂载时按钮还没建出来、内核又把类加回来、卸载后不再管。
 * 观察器回调是微任务，断言前要先把微任务队列跑空；这不是在等时间，而是在等 DOM 观察器。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import mobileSyncButton from "../../src/features/mobile-sync-button/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

const HIDDEN = "fn__none";

/** 等 DOM 观察器回调（微任务）跑完。 */
const tick = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

const buildTopBar = (): {topBar: HTMLElement; button: HTMLElement;} => {
    const topBar = document.createElement("div");
    topBar.id = "mobileTopBar";
    topBar.innerHTML =
        '<div class="mobile-topbar__item" id="toolbarSync"><svg class="mobile-tabs__item-icon"></svg></div>';
    document.body.append(topBar);
    return {topBar, button: topBar.querySelector<HTMLElement>("#toolbarSync")!};
};

describe("移动端常显立即同步", () => {
    let harness: HostHarness | undefined;

    beforeEach(() => {
        // 这个功能天生只在移动端挂载，前端类型只影响声明过滤，这里按移动端驱动
        harness = mountFeature(mobileSyncButton, {config: {enabled: true}});
    });

    afterEach(() => {
        harness?.dispose();
        harness = undefined;
    });

    it("挂载时按钮已经存在：立刻摘掉 fn__none，其它类一个不动", () => {
        const {button} = buildTopBar();
        button.classList.add(HIDDEN, "mobile-topbar__item");

        harness?.dispose();
        harness = mountFeature(mobileSyncButton, {config: {enabled: true}});

        expect(button.classList.contains(HIDDEN)).toBe(false);
        // 只动隐藏类：图标容器与位置类都要留着，否则按钮会跑到别处
        expect(button.classList.contains("mobile-topbar__item")).toBe(true);
        expect(button.classList.contains("mobile-tabs__item-icon")).toBe(false);
        expect(button.querySelector("svg")).not.toBe(null);
    });

    it("按钮本来就没被隐藏时什么也不改", () => {
        const {button} = buildTopBar();
        button.classList.add("mobile-topbar__item");
        const before = button.className;

        harness?.dispose();
        harness = mountFeature(mobileSyncButton, {config: {enabled: true}});

        expect(button.className).toBe(before);
    });

    it("内核又把 fn__none 加回来时再摘一次（这就是不能用纯 CSS 的原因）", async () => {
        const {button} = buildTopBar();

        harness?.dispose();
        harness = mountFeature(mobileSyncButton, {config: {enabled: true}});

        button.classList.add(HIDDEN);
        await tick();
        expect(button.classList.contains(HIDDEN)).toBe(false);

        // 反复加也反复摘：内核在每次同步状态刷新时都可能重写这个类
        button.classList.add(HIDDEN);
        await tick();
        expect(button.classList.contains(HIDDEN)).toBe(false);
    });

    it("挂载时顶栏还没建出来：等按钮被插入后再接管", async () => {
        // 先确保没有按钮
        expect(document.getElementById("toolbarSync")).toBe(null);

        const topBar = document.createElement("div");
        topBar.id = "mobileTopBar";
        document.body.append(topBar);
        await tick();
        expect(document.getElementById("toolbarSync")).toBe(null);

        topBar.innerHTML = '<div id="toolbarSync" class="fn__none"></div>';
        await tick();

        const button = document.getElementById("toolbarSync")!;
        expect(button.classList.contains(HIDDEN)).toBe(false);
    });

    it("接管之后继续盯着这颗按钮，再加 fn__none 仍然会被摘掉", async () => {
        const topBar = document.createElement("div");
        document.body.append(topBar);
        topBar.innerHTML = '<div id="toolbarSync" class="fn__none"></div>';
        await tick();

        const button = document.getElementById("toolbarSync")!;
        button.classList.add(HIDDEN);
        await tick();

        expect(button.classList.contains(HIDDEN)).toBe(false);
    });

    it("找到按钮后停止定位观察：不会再对后来新建的按钮动手", async () => {
        const {button} = buildTopBar();
        await tick();
        expect(button.classList.contains(HIDDEN)).toBe(false);

        // 顶栏被整体重建：定位观察器已经断开，新按钮保持内核给的状态
        // （观察器只为「等顶栏出现」服务，反复扫描整页会白烧 CPU）
        button.remove();
        await tick();
        const replacement = document.createElement("div");
        replacement.id = "toolbarSync";
        replacement.className = HIDDEN;
        document.body.append(replacement);
        await tick();

        expect(replacement.classList.contains(HIDDEN)).toBe(true);
    });

    it("卸载后不再干预：把 fn__none 加回去就保持隐藏", async () => {
        const {button} = buildTopBar();
        await tick();

        harness?.dispose();
        harness = undefined;

        button.classList.add(HIDDEN);
        await tick();
        expect(button.classList.contains(HIDDEN)).toBe(true);
    });

    it("还没找到按钮就卸载：之后按钮出现也不会被揭示（定位观察器随卸载断开）", async () => {
        harness?.dispose();
        harness = undefined;

        const topBar = document.createElement("div");
        document.body.append(topBar);
        topBar.innerHTML = '<div id="toolbarSync" class="fn__none"></div>';
        await tick();

        expect(document.getElementById("toolbarSync")!.classList.contains(HIDDEN)).toBe(true);
    });

    it("destroy() 幂等：重复调用不抛错，也不会把观察器重新挂上", async () => {
        const {button} = buildTopBar();
        await tick();

        const instance = harness!.instance!;
        instance.destroy?.();
        instance.destroy?.();
        await tick();

        button.classList.add(HIDDEN);
        await tick();
        expect(button.classList.contains(HIDDEN)).toBe(true);
    });
});
