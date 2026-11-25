/**
 * 「自动收起闲置页签」的计时时序。
 *
 * `policy.ts` 的判定规则在另一份测试里逐条钉死；这里管的是它周围那层时序：什么时候计时、
 * 什么时候扫描、界面前后台切换算不算闲置。全部用假定时器，把真实才有的那几分钟固定下来。
 *
 * 页面是「按宿主形状搭的假 DOM」，只求喂给采集逻辑：分屏里的 `data-type="wnd"`、
 * 页签栏、页签面板，以及点一下就消失的关闭按钮（真机上是过渡动画结束后移除）。
 * 移动端那几例换成页签模型的替身，钉住「静默收起」：宿主关后台页签会顺手弹页签总览，这里不能弹。
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
            `<li class="item${
                index === 0 ? " item--focus" : ""
            }" data-type="tab-header" data-id="${id}" data-activetime="${BASE}">
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

/** 移动端页签模型的测试替身：关掉后台页签的最后一步会打开「页签总览」抽屉。 */
interface MobileTabsDouble {
    tabs: {id: string; current: {title: string; rootID: string;}; activeAt: number;}[];
    state: {activeTabID?: string; tabs: MobileTabsDouble["tabs"];};
    /** 「页签总览」抽屉被打开的次数。 */
    overviews: number;
    close: (tabID: string) => Promise<void>;
    openOverview: () => void;
}

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

    describe("mobile", () => {
        /**
         * 搭一份移动端页签模型，形状照宿主的 `MobileTabs`：
         * 关掉后台页签的最后一步会打开「页签总览」抽屉（摆进共用的 `#model`）。
         */
        const renderMobile = (titles: string[]): MobileTabsDouble => {
            const model = document.createElement("div");
            model.id = "model";
            const modelMain = document.createElement("div");
            modelMain.id = "modelMain";
            const modelClose = document.createElement("button");
            modelClose.id = "modelClose";
            model.append(modelMain, modelClose);
            document.body.replaceChildren(model);
            const tabs = titles.map((title, index) => ({
                id: `tab-${index}`,
                current: {title, rootID: `root-${index}`},
                activeAt: BASE,
            }));
            const overview = document.createElement("div");
            overview.className = "mobile-tabs";
            const double: MobileTabsDouble = {
                tabs,
                overviews: 0,
                openOverview: () => undefined,
            };
            double.openOverview = () => {
                double.overviews += 1;
                model.style.transform = "translateX(0px)";
                modelMain.replaceChildren(overview);
            };
            double.state = {activeTabID: tabs[0].id, tabs};
            double.close = async (tabID: string) => {
                const index = tabs.findIndex((item) => item.id === tabID);
                if (index < 0) {
                    return;
                }
                const wasActive = tabs[index].id === double.state.activeTabID;
                tabs.splice(index, 1);
                if (!wasActive) {
                    double.openOverview();
                }
            };
            window.siyuan.mobile = {tabs: double} as unknown as typeof window.siyuan.mobile;
            return double;
        };

        afterEach(() => {
            Reflect.deleteProperty(window.siyuan, "mobile");
        });

        it("closes idle mobile tabs without opening the tab overview", async () => {
            const mobile = renderMobile(["active", "old", "older"]);
            const openOverview = mobile.openOverview;
            const host = mount();

            await vi.advanceTimersByTimeAsync(6 * MINUTE);

            expect(mobile.tabs.map((tab) => tab.current.title)).toEqual(["active"]);
            expect(mobile.overviews).toBe(0);
            expect(document.getElementById("model")?.style.transform).toBe("");
            expect(closedLogs(host)).toEqual(["closed 2 idle tab(s)"]);
            // 遮蔽只活在关闭那一段里，关完要把宿主自己的入口还回去
            expect(mobile.openOverview).toBe(openOverview);
        });

        it("refreshes the overview when the user is already looking at it", async () => {
            const mobile = renderMobile(["active", "old"]);
            mobile.openOverview();
            mobile.overviews = 0;
            mount();

            await vi.advanceTimersByTimeAsync(6 * MINUTE);

            expect(mobile.tabs.map((tab) => tab.current.title)).toEqual(["active"]);
            // 界面本来就开着，宿主重绘列表正好把收掉的页签摘掉
            expect(mobile.overviews).toBe(1);
        });

        it("leaves another open drawer alone", async () => {
            const mobile = renderMobile(["active", "old"]);
            document.getElementById("model")!.style.transform = "translateX(0px)";
            const drawer = document.createElement("div");
            drawer.className = "mobile-tree";
            document.getElementById("modelMain")!.replaceChildren(drawer);
            mount();

            await vi.advanceTimersByTimeAsync(6 * MINUTE);

            expect(mobile.tabs.map((tab) => tab.current.title)).toEqual(["active"]);
            // 用户在看别的抽屉：不遮蔽就会把文档树换成页签列表
            expect(mobile.overviews).toBe(0);
            expect(document.querySelector("#modelMain .mobile-tree")).not.toBeNull();
        });
    });
});
