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
                <span class="b3-list-item__text">Whole document bookmark</span>
                <span class="b3-list-item__action">More</span>
                <span class="b3-list-item__toggle">Collapse</span>
            </li>
            <li class="b3-list-item" data-node-id="block-1" data-type="NodeParagraph">
                <span class="b3-list-item__text">Block bookmark</span>
            </li>
            <li class="b3-list-item" data-type="NodeDocument">
                <span class="b3-list-item__text">No id</span>
            </li>
        </ul>
    </div>
    <div class="bookmarkList"><ul>
        <li data-node-id="doc-2" data-type="NodeDocument">Mobile bookmark</li>
    </ul></div>
    <div class="not-a-bookmark"><ul>
        <li data-node-id="doc-3" data-type="NodeDocument">Other list</li>
    </ul></div>
`;

const render = (): void => {
    document.body.innerHTML = BOOKMARK_DOM;
};

/** 按 id 取书签行；id 是断言里最稳定的锚点。 */
const row = (nodeId: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(`li[data-node-id="${nodeId}"]`);
    if (!element) {
        throw new Error(`bookmark row ${nodeId} is not in the DOM`);
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

describe("opening a note from a bookmark jumps to the last position", () => {
    it("desktop click on a whole-document bookmark: swapped for an openTab carrying cb-get-scroll, and the kernel click is intercepted", () => {
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

    it("listener sits in the capture phase: even a non-bubbling click is caught", () => {
        mount();

        // 只挂冒泡监听会漏掉「宿主自己拦截后再派发」的那条路；
        // 这里用 bubbles: false 的点击验证捕获阶段确实生效。
        dispatchClick(row("doc-1"), {bubbles: false});

        expect(openTab).toHaveBeenCalledTimes(1);
        expect(vi.mocked(openTab).mock.calls[0][0].doc.id).toBe("doc-1");
    });

    it("mobile goes through openMobileFileById with cb-get-scroll only", () => {
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

    it("browser-mobile is handled as mobile too", () => {
        mockState.frontend = "browser-mobile";
        mount();

        dispatchClick(row("doc-2"));

        expect(openMobileFileById).toHaveBeenCalledTimes(1);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("both bookmark panels are recognized: .sy__bookmark and .bookmarkList", () => {
        mount();

        dispatchClick(row("doc-1"));
        dispatchClick(row("doc-2"));

        expect(vi.mocked(openTab).mock.calls.map((call) => call[0].doc.id)).toEqual(["doc-1", "doc-2"]);
    });

    it("block bookmarks are not taken over: a bookmark on a block should jump to that block", () => {
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

    it("the More menu and the collapse arrow keep their own behavior and are not stolen", () => {
        mount();

        dispatchClick(row("doc-1").querySelector(".b3-list-item__action") as HTMLElement);
        dispatchClick(row("doc-1").querySelector(".b3-list-item__toggle") as HTMLElement);

        expect(openTab).not.toHaveBeenCalled();
    });

    it("modifier keys and middle click mean something else (new tab / split / no jump) and always pass through", () => {
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

    it("similar rows outside the bookmark panels, and rows without data-node-id, are untouched", () => {
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

    it("clicking on document (target is not an element) neither throws nor opens", () => {
        mount();

        // event.target 可能是 document 本身，`instanceof Element` 的守卫就是为它写的
        expect(() => {
            document.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }).not.toThrow();
        expect(openTab).not.toHaveBeenCalled();
    });

    it("destroy removes the listener and a repeated destroy does not throw", () => {
        const harness = mount();
        const instance = harness.instance as {destroy: () => void;};
        expect(typeof instance.destroy).toBe("function");

        harness.dispose();
        dispatchClick(row("doc-1"));
        expect(openTab).not.toHaveBeenCalled();

        expect(() => instance.destroy()).not.toThrow();
        expect(() => harness.dispose()).not.toThrow();
    });

    it("declaration: doc-tree category, off by default, a single enabled switch", () => {
        expect(definition.id).toBe("bookmark-last-position");
        expect(definition.category).toBe("doc-tree");
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });
});
