/**
 * 移动端下拉用思源原生样式。
 *
 * 这个功能几乎全是「时序」问题，用例就按踩过的坑排：
 *
 * 1. **菜单不能在按下的瞬间弹**。内核的菜单在移动端是底部弹层，自带一层遮罩，遮罩与 window
 *    上的 click 处理器都会把它关掉。按下就弹，这次点击的「尾巴」（mousedown / mouseup / click）
 *    会落在刚出现的遮罩上，菜单「闪一下就消失」；而手指在控件上滑动不产生 click，于是现象变成
 *    「只有滑动能用、点按不行」。所以按下只 `preventDefault()`，菜单留到抬起。
 * 2. **`touchstart` 里绝不能 `preventDefault()`**。那会连页面滚动一起取消，手指落在下拉上
 *    就再也划不动；原生弹层属于「点击」的默认行为，在 `touchend` 取消一次就够。
 * 3. **滑动不是点选**。位移超过阈值一律不弹菜单，也不要吞掉默认行为。
 * 4. 选中之后必须**补发 `input` / `change`**，否则内核与其它插件都收不到变更。
 *
 * 宿主替身（`tests/mocks/siyuan.ts`）的 `Menu` 只有 `addItem` / `open`，没有宿主的 `close()`，
 * 而被测代码在「换一份新菜单」和 `destroy` 时都会调它，所以这里给原型补一个可断言的桩。
 */
import {Menu} from "siyuan";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/mobile-select-native/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

const closeMenu = vi.fn();
(Menu.prototype as unknown as {close: () => void;}).close = closeMenu;

interface MenuItem {
    label: string;
    checked?: boolean;
    click?: () => void;
}

interface OpenedMenu {
    items: MenuItem[];
    options?: {x: number; y: number; h: number; w: number;};
}

let opened: OpenedMenu[] = [];

const originalOpen = Menu.prototype.open;

beforeEach(() => {
    opened = [];
    closeMenu.mockClear();
    // 宿主的 Menu 实例由被测代码自己 new，测试只能从原型上截下来看它装了什么
    Menu.prototype.open = vi.fn(function(this: {items: MenuItem[];}, options?: OpenedMenu["options"]): void {
        opened.push({items: this.items, options});
    }) as unknown as typeof Menu.prototype.open;
});

const mounted: HostHarness[] = [];

const mount = (): HostHarness => {
    const harness = mountFeature(definition);
    mounted.push(harness);
    return harness;
};

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    Menu.prototype.open = originalOpen;
    vi.useRealTimers();
});

const makeSelect = (
    options: [string, string][],
    attributes: {className?: string; disabled?: boolean;} = {},
): HTMLSelectElement => {
    const select = document.createElement("select");
    select.className = attributes.className ?? "b3-select";
    options.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
    });
    select.disabled = Boolean(attributes.disabled);
    document.body.append(select);
    return select;
};

const rectOf = (left: number, top: number, width: number, height: number): DOMRect =>
    ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    }) as DOMRect;

/** jsdom 不排版，rect 恒为全 0；菜单的定位参数取自它，所以要给 select 补一个。 */
const layout = (element: HTMLElement, box: {left: number; top: number; width: number; height: number;}): void => {
    element.getBoundingClientRect = () => rectOf(box.left, box.top, box.width, box.height);
};

const point = (type: string, init: MouseEventInit = {}): MouseEvent =>
    new MouseEvent(type, {bubbles: true, cancelable: true, ...init});

/**
 * jsdom 的 `TouchEvent` 不接受普通的箭头对象做 `changedTouches`，而源码只读
 * `changedTouches[0].clientX/clientY`，所以这里造一个普通事件再把触摸点挂上去。
 */
const touch = (type: string, x: number, y: number): Event => {
    const event = new Event(type, {bubbles: true, cancelable: true});
    Object.defineProperty(event, "changedTouches", {value: [{clientX: x, clientY: y}]});
    return event;
};

/** 一次完整的手势：按下 + 抬起（pointer / mouse 那一套）。 */
const tap = (target: Element, x = 10, y = 10): MouseEvent => {
    target.dispatchEvent(point("pointerdown", {button: 0, clientX: x, clientY: y}));
    const up = point("pointerup", {button: 0, clientX: x, clientY: y});
    target.dispatchEvent(up);
    return up;
};

describe("移动端下拉用思源原生样式", () => {
    it("声明：只在移动端交出，到 3.8.7-alpha.2 为止（之后宿主自己统一了下拉）", () => {
        expect(definition.id).toBe("mobile-select-native");
        expect(definition.category).toBe("appearance");
        expect(definition.name).toBe("feature.mobileSelectNative.title");
        expect(definition.enabled).toBe(true);
        expect(definition.frontends).toEqual(["mobile"]);
        // 上游从 v3.8.7-alpha.2 起自己实现了，上限取它的前一个版本：超过就不再加载
        expect(definition.maxAppVersion).toBe("3.8.7-alpha.2");
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });

    it("按下只挡浏览器默认弹层，菜单要等到抬起才弹（否则会被这次点击的尾巴关掉）", () => {
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        mount();

        const down = point("pointerdown", {button: 0});
        select.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        // 这一刻弹菜单，随后补发的 mousedown / mouseup / click 会落在遮罩上，菜单闪一下就消失
        expect(opened).toHaveLength(0);

        select.dispatchEvent(point("pointerup", {button: 0}));
        expect(opened).toHaveLength(1);
    });

    it("菜单项按 option 顺序列出、label 取文字、checked 标在当前值上，定位参数取自控件", () => {
        const select = makeSelect([["a", "甲"], ["b", "乙"], ["c", "丙"]]);
        select.value = "b";
        layout(select, {left: 30, top: 40, width: 200, height: 36});
        mount();

        tap(select);

        expect(opened).toHaveLength(1);
        expect(opened[0].items.map((item) => item.label)).toEqual(["甲", "乙", "丙"]);
        expect(opened[0].items.map((item) => item.checked)).toEqual([false, true, false]);
        expect(opened[0].options).toEqual({x: 30, y: 76, h: 36, w: 200});
        // 「选项个数」是排查「菜单空着」时唯一能对上的日志
        expect(mountLogs()).toContain("native menu took over the select (3 options)");
    });

    it("option 没有文字时 label 回落到 value", () => {
        const select = makeSelect([["alpha", ""]]);
        mount();

        tap(select);

        expect(opened[0].items[0].label).toBe("alpha");
    });

    it("选中另一项：写回 value，并按 input → change 的顺序在冒泡阶段补发", () => {
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        const events: string[] = [];
        select.addEventListener("input", (event) => events.push(`input:${(event as Event).bubbles}`));
        select.addEventListener("change", (event) => events.push(`change:${(event as Event).bubbles}`));
        mount();

        tap(select);
        opened[0].items[1].click?.();

        expect(select.value).toBe("b");
        // 内核与其它插件都监听 change，不补发就等于「选了不生效」
        expect(events).toEqual(["input:true", "change:true"]);
    });

    it("选中的就是当前值：不改值、也不派发任何事件", () => {
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        const listener = vi.fn();
        select.addEventListener("input", listener);
        select.addEventListener("change", listener);
        mount();

        tap(select);
        opened[0].items[0].click?.();

        expect(select.value).toBe("a");
        expect(listener).not.toHaveBeenCalled();
    });

    it("只接管思源自己的下拉：普通 select、禁用的下拉、非 select 元素都不动", () => {
        const plain = makeSelect([["a", "甲"]], {className: ""});
        const disabled = makeSelect([["a", "甲"]], {disabled: true});
        const div = document.createElement("div");
        document.body.append(div);
        mount();

        for (const target of [plain, disabled, div]) {
            const down = point("pointerdown", {button: 0});
            target.dispatchEvent(down);
            // 不接管就不能挡默认行为，否则原生下拉与普通控件会失去本来该有的交互
            expect(down.defaultPrevented).toBe(false);
            target.dispatchEvent(point("pointerup", {button: 0}));
        }
        expect(opened).toHaveLength(0);
    });

    it("手指划走（位移超过阈值）不算点选：不弹菜单，也不吞掉这次手势", () => {
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        mount();

        select.dispatchEvent(point("pointerdown", {button: 0, clientX: 10, clientY: 10}));
        const up = point("pointerup", {button: 0, clientX: 10, clientY: 40});
        select.dispatchEvent(up);

        expect(opened).toHaveLength(0);
        // 取消默认行为会连滚动一起取消；划走是滚动，不能吞
        expect(up.defaultPrevented).toBe(false);

        // 这次手势已经作废：后面再抬起一次也不能补开一个菜单
        select.dispatchEvent(point("pointerup", {button: 0, clientX: 10, clientY: 10}));
        expect(opened).toHaveLength(0);
    });

    it("触摸路径：touchstart 不 preventDefault（否则页面划不动），touchend 才开菜单", () => {
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        mount();

        const start = touch("touchstart", 10, 10);
        select.dispatchEvent(start);
        // 在 touchstart 里取消默认行为会把页面滚动一起取消，手指落在下拉上就再也划不动
        expect(start.defaultPrevented).toBe(false);
        expect(opened).toHaveLength(0);

        const end = touch("touchend", 12, 11);
        select.dispatchEvent(end);
        // 原生弹层属于「点击」的默认行为，在 touchend 取消一次就够
        expect(end.defaultPrevented).toBe(true);
        expect(opened).toHaveLength(1);
    });

    it("触摸滑动：touchend 位移超阈值时不弹菜单、也不拦默认行为", () => {
        const select = makeSelect([["a", "甲"]]);
        mount();

        select.dispatchEvent(touch("touchstart", 10, 10));
        const end = touch("touchend", 10, 30);
        select.dispatchEvent(end);

        expect(opened).toHaveLength(0);
        expect(end.defaultPrevented).toBe(false);
    });

    it("去重窗口：同一根手指 300ms 内的重复手势只开一次菜单", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        mount();

        tap(select);
        expect(opened).toHaveLength(1);

        // pointer / touch / mouse 会为同一次手势各派发一套事件，窗口内不能再开一个
        vi.advanceTimersByTime(299);
        tap(select);
        expect(opened).toHaveLength(1);

        // 窗口过去之后，新的一次点选照常生效
        vi.advanceTimersByTime(2);
        tap(select);
        expect(opened).toHaveLength(2);
    });

    it("再次打开前先把上一份菜单收掉，不叠两个弹层", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
        const select = makeSelect([["a", "甲"], ["b", "乙"]]);
        mount();

        tap(select);
        expect(closeMenu).not.toHaveBeenCalled();

        vi.advanceTimersByTime(400);
        tap(select);
        expect(closeMenu).toHaveBeenCalledTimes(1);
        expect(opened).toHaveLength(2);
    });

    it("菜单弹出后的短时间内，落在遮罩上的 click 被吞掉（内核「点菜单外面」会关掉它）", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
        const select = makeSelect([["a", "甲"]]);
        const scrim = document.createElement("div");
        scrim.id = "commonMenuScrim";
        document.body.append(scrim);
        const scrimListener = vi.fn();
        scrim.addEventListener("click", scrimListener);
        mount();

        // 还没有菜单：遮罩上的点击与这个功能无关，不能吞
        const unrelated = point("click");
        scrim.dispatchEvent(unrelated);
        expect(unrelated.defaultPrevented).toBe(false);
        expect(scrimListener).toHaveBeenCalledTimes(1);

        tap(select);
        const tail = point("click");
        scrim.dispatchEvent(tail);
        expect(tail.defaultPrevented).toBe(true);
        // stopPropagation 让这次点击连遮罩自己的监听器都到不了，菜单才不会被关掉
        expect(scrimListener).toHaveBeenCalledTimes(1);

        // 窗口之外的点击是用户真的在点外面，照常关菜单
        vi.advanceTimersByTime(800);
        const later = point("click");
        scrim.dispatchEvent(later);
        expect(later.defaultPrevented).toBe(false);
        expect(scrimListener).toHaveBeenCalledTimes(2);
    });

    it("控件自己的 click 一律吞掉：不让浏览器再走一次原生下拉", () => {
        const select = makeSelect([["a", "甲"]]);
        const selectListener = vi.fn();
        select.addEventListener("click", selectListener);
        mount();

        const event = point("click");
        select.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(selectListener).not.toHaveBeenCalled();
        // 点控件不该被当成「点菜单外面」
        expect(opened).toHaveLength(0);
    });

    it("pointercancel / touchcancel 之后这次手势作废，抬起时不再弹菜单", () => {
        const select = makeSelect([["a", "甲"]]);
        mount();

        select.dispatchEvent(point("pointerdown", {button: 0}));
        select.dispatchEvent(point("pointercancel"));
        select.dispatchEvent(point("pointerup", {button: 0}));
        expect(opened).toHaveLength(0);

        select.dispatchEvent(touch("touchstart", 10, 10));
        select.dispatchEvent(touch("touchcancel", 10, 10));
        select.dispatchEvent(touch("touchend", 10, 10));
        expect(opened).toHaveLength(0);
    });

    it("destroy 拆掉全部监听并收掉菜单，不再拦任何事件", () => {
        const select = makeSelect([["a", "甲"]]);
        const harness = mount();
        tap(select);
        expect(opened).toHaveLength(1);

        const instance = harness.instance;
        harness.dispose();
        expect(closeMenu).toHaveBeenCalledTimes(1);

        // 监听全拆：按下不再被挡，抬起也不再弹菜单
        const down = point("pointerdown", {button: 0});
        select.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(false);
        select.dispatchEvent(point("pointerup", {button: 0}));
        expect(opened).toHaveLength(1);

        // 宿主的菜单已经收掉，重复 destroy 不能因为拿到空引用再炸一次
        expect(() => instance?.destroy?.()).not.toThrow();
        expect(closeMenu).toHaveBeenCalledTimes(1);
    });

    it("mount 只挂事件监听：不注入样式、不注册任何入口", () => {
        const harness = mount();
        expect(harness.records.styles).toHaveLength(0);
        expect(harness.records.bus).toHaveLength(0);
        expect(harness.records.commands).toHaveLength(0);
        expect(harness.records.topBars).toHaveLength(0);
        expect(harness.instance?.destroy).toBeTypeOf("function");
    });

    it("移动端前端下才有的实现：桌面端也不拒绝挂载（前端筛选由注册表负责）", () => {
        // 这个文件本身不判前端，是否挂载由声明的 frontends 决定；
        // 这里固定桌面端再挂一次，确认它不依赖当前前端就能工作
        mockState.frontend = "desktop";
        const select = makeSelect([["a", "甲"]]);
        mount();

        tap(select);
        expect(opened).toHaveLength(1);
    });
});

/** 当前挂载实例记下的日志（`host.log` 的第一条参数）。 */
const mountLogs = (): string[] => mounted.flatMap((harness) => harness.records.logs.map((args) => String(args[0])));
