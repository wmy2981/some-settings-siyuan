/**
 * 「自动收起闲置页签」的计时时序。
 *
 * `policy.ts` 的判定规则在另一份测试里逐条钉死；这里管的是它周围那层时序：什么时候计时、
 * 什么时候扫描、界面前后台切换算不算闲置。全部用假定时器，把真实才有的那几分钟固定下来。
 *
 * 页面是「按宿主形状搭的假 DOM」，只求喂给采集逻辑：分屏里的 `data-type="wnd"`、
 * 页签栏、页签面板，以及点一下就消失的关闭按钮（真机上是过渡动画结束后移除）。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import tabAutoClose from "../../src/features/tab-auto-close";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";

const MINUTE = 60_000;
const BASE = 1_700_000_000_000;

let visibility: "visible" | "hidden";

const setVisibility = (next: "visible" | "hidden"): void => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
};

/** 搭一个只有页签的桌面分屏；第一个页签是当前活动页签。 */
const renderDesktop = (ids: string[]): void => {
    document.body.innerHTML = `<div data-type="wnd">
    <div class="fn__flex">
        <ul class="fn__flex layout-tab-bar"></ul>
        <ul class="layout-tab-bar layout-tab-bar--readonly fn__flex-1"></ul>
    </div>
    <div class="layout-tab-container fn__flex-1"></div>
</div>`;
    const bar = document.querySelector<HTMLElement>(".layout-tab-bar:not(.layout-tab-bar--readonly)")!;
    const container = document.querySelector<HTMLElement>(".layout-tab-container")!;
    ids.forEach((id, index) => {
        bar.insertAdjacentHTML(
            "beforeend",
            `<li class="item${index === 0 ? " item--focus" : ""}" data-type="tab-header" data-id="${id}" data-activetime="${BASE}">
    <span class="item__text">${id}</span><span class="item__close"></span></li>`,
        );
        container.insertAdjacentHTML("beforeend", `<div class="fn__flex-1" data-id="${id}"></div>`);
    });
    // 宿主的关闭入口：点了就把页签摘掉
    bar.querySelectorAll<HTMLElement>(".item__close").forEach((button) => {
        button.addEventListener("click", () => button.closest("li")?.remove());
    });
};

const remainingTabs = (): string[] =>
    Array.from(document.querySelectorAll<HTMLElement>('li.item[data-type="tab-header"]'))
        .map((header) => header.dataset.id ?? "");

const closedLogs = (harness: HostHarness): string[] =>
    harness.records.logs.map((args) => String(args[0])).filter((text) => text.startsWith("closed "));

describe("mountTabAutoClose", () => {
    let harness: HostHarness | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
        visibility = "visible";
        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => visibility,
        });
    });

    afterEach(() => {
        harness?.dispose();
        harness = undefined;
        vi.useRealTimers();
        Reflect.deleteProperty(document, "visibilityState");
    });

    const mount = (): HostHarness => {
        harness = mountFeature(tabAutoClose, {config: {minutes: 5}});
        return harness;
    };

    it("leaves everything alone right after mounting", async () => {
        renderDesktop(["active", "other"]);
        const host = mount();

        await vi.advanceTimersByTimeAsync(MINUTE);

        expect(remainingTabs()).toEqual(["active", "other"]);
        expect(closedLogs(host)).toEqual([]);
    });

    it("closes the tabs that stayed idle past the threshold", async () => {
        renderDesktop(["active", "old", "older"]);
        const host = mount();

        await vi.advanceTimersByTimeAsync(6 * MINUTE);

        expect(remainingTabs()).toEqual(["active"]);
        expect(closedLogs(host)).toEqual(["closed 2 idle tab(s)"]);
    });

    it("does not close anything while the window is in the background", async () => {
        renderDesktop(["active", "other"]);
        mount();

        setVisibility("hidden");
        await vi.advanceTimersByTimeAsync(10 * MINUTE);

        expect(remainingTabs()).toEqual(["active", "other"]);
    });

    it("keeps counting while the window is in the background", async () => {
        // 切出去一分钟再回来，闲置时间不能归零：否则「闲置五分钟」实际要求界面连续可见五分钟，
        // 习惯频繁切窗口的人永远等不到一次收起，功能就等于没生效。
        renderDesktop(["active", "other"]);
        const host = mount();

        await vi.advanceTimersByTimeAsync(30_000);
        setVisibility("hidden");
        await vi.advanceTimersByTimeAsync(30_000);
        setVisibility("visible");
        await vi.advanceTimersByTimeAsync(4 * MINUTE + 1_000);

        expect(remainingTabs()).toEqual(["active"]);
        expect(closedLogs(host)).toEqual(["closed 1 idle tab(s)"]);
    });
});
