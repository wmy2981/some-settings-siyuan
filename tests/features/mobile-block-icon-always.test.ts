/**
 * 移动端块标保持显示。
 *
 * 这个功能不画块标，只在**内核把 gutter 清空的那一刻把刚才那份 innerHTML 与内联定位搬回去**，
 * 所以测试要先照宿主的真实结构造 `.protyle-gutters`：一个容器里若干
 * `button[data-node-id]`，完整块标模式下外层容器在前、当前块在最后。
 *
 * 关键是三组断言：
 * - 搬回的是原样内容（HTML + cssText），且块必须还在文档里、操作对象还必须对得上；
 * - 「正在操作某个块」由 pointerdown 收尾，点块标自己 / 点同一个块都不算结束；
 * - 观察者、pointerdown 监听、2 秒兜底扫描、事件总线订阅在 `destroy()` 后全部失效。
 *
 * jsdom 里没有 PointerEvent（只有 MouseEvent / Event），所以 pointerdown 用同名的 Event 派发；
 * 内核在这里也只关心 target，不读 pointer 专属字段。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/mobile-block-icon-always";
import {mountMobileBlockIconAlways} from "../../src/features/mobile-block-icon-always/gutter";
import {
    mountFeature,
    noopLogger,
} from "../helpers/feature-host";

/** 源码里的搬回上限；测试照抄一份，用来钉住「到了上限就交回内核」。 */
const MAX_RESTORES = 40;

/** MutationObserver 的回调是微任务；搬回自己又会再触发一次回调，所以多冲几次。 */
const flushMutations = async (): Promise<void> => {
    for (let round = 0; round < 3; round += 1) {
        await Promise.resolve();
    }
};

const buildBlock = (id: string): HTMLElement => {
    const block = document.createElement("div");
    block.setAttribute("data-node-id", id);
    document.body.append(block);
    return block;
};

interface GutterOptions {
    /** 是否给容器加上内核用来隐藏块标的 `fn__none`。 */
    hidden?: boolean;
    /** 直接给 innerHTML（默认按 ids 生成按钮）。 */
    html?: string;
}

/** 照宿主的块标容器造一份 DOM：`.protyle-gutters` + `button[data-node-id]`。 */
const buildGutter = (ids: string[], options: GutterOptions = {}) => {
    const gutter = document.createElement("div");
    gutter.className = "protyle-gutters";
    if (options.hidden) {
        gutter.classList.add("fn__none");
    }
    gutter.style.cssText = "position: fixed; left: 12px; top: 34px;";
    gutter.innerHTML = options.html ?? ids.map((id) => `<button data-node-id="${id}"></button>`).join("");
    document.body.append(gutter);
    return gutter;
};

/** 模拟内核收块标：清空内容并加 `fn__none`（两步在同一次微任务前完成）。 */
const collapse = async (gutter: HTMLElement): Promise<void> => {
    gutter.innerHTML = "";
    gutter.classList.add("fn__none");
    await flushMutations();
};

const pointerDownOn = (target: Element): void => {
    target.dispatchEvent(new Event("pointerdown", {bubbles: true}));
};

describe("移动端块标保持显示", () => {
    const mounted: {dispose: () => void; records: {logs: unknown[][];};}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
        vi.useRealTimers();
    });

    it("声明里只在移动端交出，开关默认关闭", () => {
        expect(definition.frontends).toEqual(["mobile"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
    });

    it("内核清空块标后把内容与内联定位原样搬回去", async () => {
        buildBlock("block-a");
        const gutter = buildGutter(["block-a"]);
        const originalHtml = gutter.innerHTML;
        const originalPosition = gutter.style.cssText;
        const harness = mount();

        await collapse(gutter);

        expect(gutter.innerHTML).toBe(originalHtml);
        expect(gutter.style.cssText).toBe(originalPosition);
        expect(gutter.classList.contains("fn__none")).toBe(false);
        expect(harness.records.logs).toHaveLength(1);
        expect(harness.records.logs[0][0]).toBe("restored the block icon (restore 1, block block-a)");
    });

    it("取最后一个按钮当「正在操作的块」：完整块标模式外层容器在前", async () => {
        buildBlock("parent-block");
        buildBlock("current-block");
        const gutter = buildGutter(["parent-block", "current-block"]);
        const harness = mount();

        await collapse(gutter);

        expect(harness.records.logs[0][0]).toBe("restored the block icon (restore 1, block current-block)");
    });

    it("块已经从文档里消失就不再搬回（搬回一个不存在的块的块标没有意义）", async () => {
        const block = buildBlock("block-b");
        const gutter = buildGutter(["block-b"]);
        const harness = mount();

        block.remove();
        await collapse(gutter);

        expect(gutter.innerHTML).toBe("");
        expect(harness.records.logs).toHaveLength(0);
    });

    it("点到别的块就结束这次操作，之后内核清空不再搬回", async () => {
        buildBlock("block-c");
        const other = buildBlock("block-d");
        const gutter = buildGutter(["block-c"]);
        const harness = mount();

        pointerDownOn(other);
        await collapse(gutter);

        expect(gutter.innerHTML).toBe("");
        expect(harness.records.logs).toHaveLength(0);
    });

    it("点到编辑器以外（没有 data-node-id 的元素）同样结束操作", async () => {
        buildBlock("block-e");
        const outside = document.createElement("div");
        outside.textContent = "正文以外的区域";
        document.body.append(outside);
        const gutter = buildGutter(["block-e"]);
        const harness = mount();

        pointerDownOn(outside);
        await collapse(gutter);

        expect(gutter.innerHTML).toBe("");
        expect(harness.records.logs).toHaveLength(0);
    });

    it("点在块标自己身上不算结束：那正是要持续操作的入口", async () => {
        buildBlock("block-f");
        const gutter = buildGutter(["block-f"]);
        const harness = mount();

        pointerDownOn(gutter.querySelector("button") as HTMLElement);
        await collapse(gutter);

        expect(gutter.innerHTML).not.toBe("");
        expect(harness.records.logs).toHaveLength(1);
    });

    it("重复点同一个块不算结束（连续操作同一个块是最常见的场景）", async () => {
        const block = buildBlock("block-g");
        const gutter = buildGutter(["block-g"]);
        const harness = mount();

        pointerDownOn(block);
        pointerDownOn(block);
        await collapse(gutter);

        expect(gutter.innerHTML).not.toBe("");
        expect(harness.records.logs).toHaveLength(1);
    });

    it("内核改画另一个块的块标时，pin 跟着换成新块", async () => {
        buildBlock("block-h");
        buildBlock("block-i");
        const gutter = buildGutter(["block-h"]);
        const harness = mount();

        // 内核重新渲染：内容换成另一个块
        gutter.innerHTML = '<button data-node-id="block-i"></button>';
        await flushMutations();
        await collapse(gutter);

        expect(harness.records.logs.at(-1)?.[0]).toBe("restored the block icon (restore 1, block block-i)");
    });

    it("同一个块最多搬回 40 次，之后交回内核自己的显隐", async () => {
        buildBlock("block-j");
        const gutter = buildGutter(["block-j"]);
        const harness = mount();

        for (let round = 0; round < MAX_RESTORES + 5; round += 1) {
            await collapse(gutter);
        }

        expect(harness.records.logs).toHaveLength(MAX_RESTORES);
        expect(harness.records.logs.at(-1)?.[0]).toBe("restored the block icon (restore 40, block block-j)");
        // 到了上限就不再搬回，容器留空、连 fn__none 也不再替内核摘掉，完全交回它自己
        expect(gutter.innerHTML).toBe("");
        expect(gutter.classList.contains("fn__none")).toBe(true);
    });

    it("挂载后新出现的编辑器靠 2 秒兜底扫描接管", async () => {
        vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
        buildBlock("block-k");
        const harness = mount();

        // 挂载时还不存在的 gutter（反链、嵌入、搜索预览会新建自己的容器）
        const gutter = buildGutter(["block-k"]);
        vi.advanceTimersByTime(2000);
        await collapse(gutter);

        expect(harness.records.logs).toHaveLength(1);
        expect(gutter.innerHTML).not.toBe("");
    });

    it("loaded-protyle-static 事件会立刻扫描一次", async () => {
        buildBlock("block-l");
        const harness = mount();

        const gutter = buildGutter(["block-l"]);
        expect(harness.records.bus.map((item) => item.type)).toContain("loaded-protyle-static");
        harness.emitBus("loaded-protyle-static", {});
        await collapse(gutter);

        expect(harness.records.logs).toHaveLength(1);
    });

    it("内核把容器隐藏但保留内容时同样按「被收起来」处理", async () => {
        buildBlock("block-m");
        const gutter = buildGutter(["block-m"]);
        const harness = mount();

        gutter.classList.add("fn__none");
        await flushMutations();

        expect(gutter.classList.contains("fn__none")).toBe(false);
        expect(harness.records.logs).toHaveLength(1);
    });

    it("空容器、或容器里没有带 id 的按钮时什么都不做", async () => {
        const empty = buildGutter([], {hidden: true});
        const noButtons = buildGutter([], {html: '<div class="protyle-gutters__item"></div>'});
        const harness = mount();

        await collapse(empty);
        await collapse(noButtons);

        expect(harness.records.logs).toHaveLength(0);
        expect(empty.innerHTML).toBe("");
        expect(noButtons.innerHTML).toBe("");
    });

    it("pointerdown 的目标不是元素时不算「点了别处」", async () => {
        buildBlock("block-p");
        const gutter = buildGutter(["block-p"]);
        const harness = mount();

        document.dispatchEvent(new Event("pointerdown", {bubbles: true}));
        await collapse(gutter);

        expect(harness.records.logs).toHaveLength(1);
    });

    it("块 id 拼不出合法选择器时安静放弃，不把异常抛给宿主", async () => {
        buildBlock("block-q");
        const gutter = buildGutter(["block-q"]);
        const harness = mount();
        const escapeSpy = vi.spyOn(CSS, "escape").mockImplementation(() => {
            throw new Error("bad selector");
        });

        await collapse(gutter);

        expect(gutter.innerHTML).toBe("");
        expect(harness.records.logs).toHaveLength(0);
        escapeSpy.mockRestore();
    });

    it("destroy 之后不再观察、不再响应 pointerdown、也不再搬回", async () => {
        vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
        buildBlock("block-n");
        const gutter = buildGutter(["block-n"]);
        const harness = mount();

        harness.dispose();
        // 重复 dispose 不抛错
        harness.dispose();

        pointerDownOn(gutter.querySelector("button") as HTMLElement);
        await collapse(gutter);

        expect(gutter.innerHTML).toBe("");
        expect(harness.records.logs).toHaveLength(0);

        // 兜底扫描也停了：新容器不会因为时间推进被接管
        const late = buildGutter(["block-n"]);
        vi.advanceTimersByTime(4000);
        await collapse(late);
        expect(late.innerHTML).toBe("");
        expect(harness.records.logs).toHaveLength(0);
    });

    it("事件总线订阅随卸载一并退掉（dispose 之后再来事件也不会扫描）", async () => {
        buildBlock("block-o");
        const harness = mount();
        harness.dispose();

        const gutter = buildGutter(["block-o"]);
        expect(harness.records.bus).toHaveLength(0);
        harness.emitBus("loaded-protyle-static", {});
        await collapse(gutter);

        expect(gutter.innerHTML).toBe("");
    });

    it("挂载只登记一次事件总线 / 一个定时器，destroy 后定时器被清掉", () => {
        const setIntervalSpy = vi.spyOn(window, "setInterval");
        const clearIntervalSpy = vi.spyOn(window, "clearInterval");
        const host = {
            config: {},
            log: noopLogger,
            addEventBus: () => undefined,
        } as unknown as FeatureHost;

        const instance = mountMobileBlockIconAlways(host);
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy.mock.calls[0][1]).toBe(2000);

        instance?.destroy();

        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });
});
