/**
 * 书签打开笔记时跳到上次位置（bookmark-last-position）。
 *
 * 内核只在「文档树打开笔记」那条路上带 `cb-get-scroll`，书签那条路带的是
 * `cb-get-rootscroll`，所以位置恢复根本没被触发，看起来像跳回了开头。
 * 本功能不自己记位置、也不补滚动：它在捕获阶段接管「整篇文档书签」的左键单击，
 * 换成与文档树一字不差的打开动作，剩下的交给内核那条原有通道。
 *
 * 因此这里断言的全部是「这次点击有没有被拦下、被换成了哪一次打开调用」，
 * 而不是滚动位置本身 —— 滚动由内核做，jsdom 里也没有真实的滚动。
 */
import {
    openMobileFileById,
    openTab,
} from "siyuan";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/bookmark-last-position/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/**
 * 本文件挂载过的实例。
 *
 * 功能把监听挂在 `document` 上，而 `tests/setup.ts` 只清 DOM 内容、不会摘监听，
 * 不逐个卸载的话后面每个测试都会多出一个监听、openTab 被调用多次。
 */
const mounted: HostHarness[] = [];

const mount = (): HostHarness => {
    const harness = mountFeature(definition);
    mounted.push(harness);
    return harness;
};

/** 书签面板的两种形态（桌面左栏 / 移动端列表）。 */
const BOOKMARK_DOM = `
    <div class="sy__bookmark">
        <ul>
            <li class="b3-list-item" data-node-id="doc-1" data-type="NodeDocument">
                <span class="b3-list-item__text">整篇文档书签</span>
                <span class="b3-list-item__action">更多</span>
                <span class="b3-list-item__toggle">折叠</span>
            </li>
            <li class="b3-list-item" data-node-id="block-1" data-type="NodeParagraph">
                <span class="b3-list-item__text">块书签</span>
            </li>
            <li class="b3-list-item" data-type="NodeDocument">
                <span class="b3-list-item__text">没有 id</span>
            </li>
        </ul>
    </div>
    <div class="bookmarkList"><ul>
        <li data-node-id="doc-2" data-type="NodeDocument">移动端书签</li>
    </ul></div>
    <div class="not-a-bookmark"><ul>
        <li data-node-id="doc-3" data-type="NodeDocument">别的列表</li>
    </ul></div>
`;

const render = (): void => {
    document.body.innerHTML = BOOKMARK_DOM;
};

/** 按 id 取书签行；id 是断言里最稳定的锚点。 */
const row = (nodeId: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(`li[data-node-id="${nodeId}"]`);
    if (!element) {
        throw new Error(`书签行 ${nodeId} 不在 DOM 里`);
    }
    return element;
};

const dispatchClick = (element: Element, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true, ...init});
    element.dispatchEvent(event);
    return event;
};

/**
 * 挂一个冒泡阶段的 document 监听当「内核那次点击」的替身。
 *
 * 功能是在捕获阶段 `stopPropagation()` 的，所以这个监听没被调用就说明点击真的被拦住了；
 * 监听挂在 document 上、每个测试自己摘掉 —— `tests/setup.ts` 只清 DOM 内容，不清监听。
 */
const trapBubbleClick = (): {spy: ReturnType<typeof vi.fn>; release: () => void;} => {
    const spy = vi.fn();
    document.addEventListener("click", spy);
    return {spy, release: () => document.removeEventListener("click", spy)};
};

beforeEach(() => {
    vi.mocked(openTab).mockClear();
    vi.mocked(openMobileFileById).mockClear();
    render();
});

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
});

describe("书签打开笔记时跳到上次位置", () => {
    it("桌面端点整篇文档书签：换成带 cb-get-scroll 的 openTab，并拦下内核那次点击", () => {
        const harness = mount();
        const {spy, release} = trapBubbleClick();
        try {
            dispatchClick(row("doc-1").querySelector(".b3-list-item__text") as HTMLElement);

            // 与文档树完全一致的两个动作：没有 cb-get-focus 就恢复不到光标，
            // 没有 cb-get-scroll 就恢复不到位置 —— 少一个都会退回「跳到开头」。
            expect(openTab).toHaveBeenCalledTimes(1);
            const options = vi.mocked(openTab).mock.calls[0][0] as {
                app: unknown;
                doc: {id: string; action: string[];};
            };
            expect(options.doc.id).toBe("doc-1");
            expect(options.doc.action).toEqual(["cb-get-focus", "cb-get-scroll"]);
            expect(options.app).toBe(harness.host.plugin.app);
            // 不拦的话内核会按自己的动作再打开一次，两路并发
            expect(spy).not.toHaveBeenCalled();
        } finally {
            release();
        }
    });

    it("监听挂在捕获阶段：不冒泡的 click 也要被接住", () => {
        mount();

        // 只挂冒泡监听会漏掉「宿主自己拦截后再派发」的那条路；
        // 这里用 bubbles: false 的点击验证捕获阶段确实生效。
        dispatchClick(row("doc-1"), {bubbles: false});

        expect(openTab).toHaveBeenCalledTimes(1);
        expect(vi.mocked(openTab).mock.calls[0][0].doc.id).toBe("doc-1");
    });

    it("移动端走 openMobileFileById，只带 cb-get-scroll", () => {
        mockState.frontend = "mobile";
        const harness = mount();

        dispatchClick(row("doc-2"));

        // 移动端宿主只有这一个「按 id 打开文件」的入口，动作集也与桌面端不同：
        // 移动端没有 cb-get-focus 这条路，多带反而与文档树的行为不一致。
        expect(openMobileFileById).toHaveBeenCalledTimes(1);
        expect(vi.mocked(openMobileFileById).mock.calls[0]).toEqual([
            harness.host.plugin.app,
            "doc-2",
            ["cb-get-scroll"],
        ]);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("browser-mobile 也按移动端处理", () => {
        mockState.frontend = "browser-mobile";
        mount();

        dispatchClick(row("doc-2"));

        expect(openMobileFileById).toHaveBeenCalledTimes(1);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("两个书签面板都认：.sy__bookmark 与 .bookmarkList", () => {
        mount();

        dispatchClick(row("doc-1"));
        dispatchClick(row("doc-2"));

        expect(vi.mocked(openTab).mock.calls.map((call) => call[0].doc.id)).toEqual(["doc-1", "doc-2"]);
    });

    it("块书签不接管：加在块上的书签本来就该跳到那个块", () => {
        mount();
        const {spy, release} = trapBubbleClick();
        try {
            dispatchClick(row("block-1"));

            expect(openTab).not.toHaveBeenCalled();
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            release();
        }
    });

    it("「更多」菜单与折叠箭头有自己的行为，不能被抢走", () => {
        mount();

        dispatchClick(row("doc-1").querySelector(".b3-list-item__action") as HTMLElement);
        dispatchClick(row("doc-1").querySelector(".b3-list-item__toggle") as HTMLElement);

        expect(openTab).not.toHaveBeenCalled();
    });

    it("修饰键与中键点的是另一套语义（新页签 / 分屏 / 不跳转），一律放行", () => {
        mount();
        const {spy, release} = trapBubbleClick();
        try {
            dispatchClick(row("doc-1"), {ctrlKey: true});
            dispatchClick(row("doc-1"), {metaKey: true});
            dispatchClick(row("doc-1"), {altKey: true});
            dispatchClick(row("doc-1"), {shiftKey: true});
            dispatchClick(row("doc-1"), {button: 1});

            expect(openTab).not.toHaveBeenCalled();
            expect(spy).toHaveBeenCalledTimes(5);
        } finally {
            release();
        }
    });

    it("书签面板之外的同类行、以及没有 data-node-id 的行都不碰", () => {
        mount();
        const {spy, release} = trapBubbleClick();
        try {
            dispatchClick(row("doc-3"));
            dispatchClick(document.querySelector(".sy__bookmark li[data-type]:not([data-node-id])") as HTMLElement);

            expect(openTab).not.toHaveBeenCalled();
            expect(spy).toHaveBeenCalledTimes(2);
        } finally {
            release();
        }
    });

    it("点在 document 上（target 不是元素）不抛错也不打开", () => {
        mount();

        // event.target 可能是 document 本身，`instanceof Element` 的守卫就是为它写的
        expect(() => {
            document.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }).not.toThrow();
        expect(openTab).not.toHaveBeenCalled();
    });

    it("destroy 摘掉监听，重复 destroy 也不抛", () => {
        const harness = mount();
        const instance = harness.instance as {destroy: () => void;};
        expect(typeof instance.destroy).toBe("function");

        harness.dispose();
        dispatchClick(row("doc-1"));
        expect(openTab).not.toHaveBeenCalled();

        expect(() => instance.destroy()).not.toThrow();
        expect(() => harness.dispose()).not.toThrow();
    });

    it("声明：文档树分类、默认关闭、只带一个 enabled 开关", () => {
        expect(definition.id).toBe("bookmark-last-position");
        expect(definition.category).toBe("doc-tree");
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });
});
