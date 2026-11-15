/**
 * 资源文件菜单（`asset-info-menu`）的单元测试。
 *
 * 这个功能只通过事件总线工作，菜单由内核自己拼装，所以测试里要同时扮演两边：
 * 用 `harness.emitBus` 派发内核的那三个事件，用 `window.siyuan.menus.menu` 当「正在构建的菜单」，
 * 再用 `bind(element)` 模拟宿主把菜单项渲染成 DOM 的那一刻 —— 行里的文字是异步补上的，
 * 只有真的把元素交给它，才测得到「先占位、后填值」这件事。
 *
 * 内核响应由 `mockState.fetchPost` 驱动：被测代码走的是带回调的 `fetchPost`
 * （成功回调决定大小与修改时间，错误回调决定把这两行收起来），所以这里按参数位置
 * 直接调用对应回调，而不是只给一个 Promise。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import assetInfoMenu from "../../src/features/asset-info-menu/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";
import {
    Menu,
    mockState,
} from "../mocks/siyuan";

/** 菜单项的运行时形状（宿主只用到这些字段）。 */
interface MenuItemRecord {
    id?: string;
    type?: string;
    label?: string;
    iconHTML?: string;
    bind?: (element: HTMLElement) => void;
}

const I18N: Record<string, string> = {
    "feature.assetInfoMenu.loading": "读取中…",
    "feature.assetInfoMenu.size": "大小",
    "feature.assetInfoMenu.dimensions": "尺寸",
    "feature.assetInfoMenu.type": "类型",
    "feature.assetInfoMenu.modified": "修改时间",
};

const i18n = (key: string): string => I18N[key] ?? key;

/** 把「正在构建的菜单」挂到宿主的全局对象上，返回它本身（断言 addItem 的结果）。 */
const installMenu = (): Menu => {
    const menu = new Menu();
    (window.siyuan as unknown as {menus: {menu: Menu;};}).menus = {menu};
    return menu;
};

const itemsOf = (menu: Menu): MenuItemRecord[] => menu.items as unknown as MenuItemRecord[];

/** 模拟宿主渲染一行：先把 `label` 写进 `.b3-menu__label`，再把元素交给 `bind`。 */
const render = (item: MenuItemRecord): HTMLElement => {
    const element = document.createElement("div");
    element.innerHTML = `<div class="b3-menu__label">${item.label ?? ""}</div>`;
    item.bind?.(element);
    return element;
};

const labelOf = (element: HTMLElement): string =>
    element.querySelector<HTMLElement>(".b3-menu__label")?.textContent ?? "";

/** 让内核按「成功返回这份 data」作答。 */
const respondWith = (data: unknown, code = 0): void => {
    (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
        async (_url: unknown, _payload: unknown, callback: unknown) => {
            (callback as (response: unknown) => void)({code, data});
            return {code, data};
        },
    );
};

/** 让内核稍后（一个微任务）才作答，用来区分「先渲染、后填值」与「先填值、后渲染」。 */
const respondLater = (data: unknown, code = 0): void => {
    (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
        async (_url: unknown, _payload: unknown, callback: unknown) => {
            queueMicrotask(() => (callback as (response: unknown) => void)({code, data}));
            return {code, data};
        },
    );
};

/** 让内核走「错误回调」那条路（`fetchPost` 的第 5 个参数）。 */
const failViaErrorCallback = (): void => {
    (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
        async (...args: unknown[]) => {
            (args[4] as (() => void) | undefined)?.();
            return null;
        },
    );
};

const pngOf = (src = "assets/demo.png", naturalWidth = 0, naturalHeight = 0): HTMLImageElement => {
    const image = document.createElement("img");
    image.setAttribute("src", src);
    // jsdom 不加载图片，naturalWidth 恒为 0；要用到尺寸分支就得自己给值
    Object.defineProperty(image, "naturalWidth", {value: naturalWidth, configurable: true});
    Object.defineProperty(image, "naturalHeight", {value: naturalHeight, configurable: true});
    return image;
};

describe("资源文件菜单显示文件大小与元数据", () => {
    let harness: HostHarness;

    beforeEach(() => {
        harness = mountFeature(assetInfoMenu, {i18n});
    });

    afterEach(() => {
        harness.dispose();
    });

    it("只订阅三个资源菜单事件，卸载时全部退订", () => {
        expect(harness.instance).toEqual({});
        expect(harness.records.bus.map((item) => item.type)).toEqual([
            "open-menu-image",
            "open-menu-link",
            "click-blockicon",
        ]);

        harness.dispose();
        expect(harness.records.bus).toEqual([]);
    });

    it("图片菜单：分隔线 + 大小 / 类型 / 修改时间三行，值未回来时显示读取中", () => {
        // 内核一直不回应，用来观察占位状态
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: pngOf()});

        const items = itemsOf(menu);
        // 分隔线必须带上固定 id：宿主按 id 去重，没有它重复打开会叠线
        expect(items[0]).toMatchObject({id: "ssAssetInfoSeparator", type: "separator"});
        expect(items.map((item) => item.type)).toEqual(["separator", "readonly", "readonly", "readonly"]);
        expect(items.slice(1).map((item) => item.label)).toEqual([
            "大小: 读取中…",
            "类型: PNG",
            "修改时间: 读取中…",
        ]);
        // 图标列留空：这几行是资源自己的信息，不该带插件图标
        expect(items[1].iconHTML).toBe("");
        // 请求走内核的资源统计接口，路径就是引用里的那一份
        expect(mockState.fetchPost.mock.calls[0].slice(0, 2)).toEqual([
            "/api/asset/statAsset",
            {path: "assets/demo.png"},
        ]);
    });

    it("内核返回后把大小与修改时间写进已经渲染好的行", () => {
        respondLater({hSize: "12.3 KB", hUpdated: "2024-10-12 12:34"});
        const menu = installMenu();
        harness.emitBus("open-menu-image", {element: pngOf()});

        const items = itemsOf(menu);
        const sizeElement = render(items[1]);
        const modifiedElement = render(items[3]);
        // 渲染这一下发生在响应回来之前，所以仍是占位文字
        expect(labelOf(sizeElement)).toBe("大小: 读取中…");

        return Promise.resolve().then(() => {
            expect(labelOf(sizeElement)).toBe("大小: 12.3 KB");
            expect(labelOf(modifiedElement)).toBe("修改时间: 2024-10-12 12:34");
            expect(sizeElement.classList.contains("fn__none")).toBe(false);
        });
    });

    it("响应比渲染先到：bind 时直接显示结果，不再经过占位", () => {
        respondWith({hSize: "1.0 KB", hUpdated: "2024-01-02 03:04"});
        const menu = installMenu();
        harness.emitBus("open-menu-image", {element: pngOf()});

        return Promise.resolve().then(() => {
            const items = itemsOf(menu);
            expect(labelOf(render(items[1]))).toBe("大小: 1.0 KB");
            expect(labelOf(render(items[3]))).toBe("修改时间: 2024-01-02 03:04");
        });
    });

    it("已加载的图片直接读 naturalWidth / naturalHeight 出尺寸行，不等内核", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: pngOf("assets/a.png", 320, 240)});

        const dimensions = itemsOf(menu).find((item) => item.label?.startsWith("尺寸"));
        expect(dimensions?.label).toBe("尺寸: 320 × 240");
    });

    it("图片还没加载出尺寸（naturalWidth 为 0）时不加尺寸行，避免显示 0 × 0", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: pngOf("assets/a.png", 0, 0)});

        expect(itemsOf(menu).some((item) => item.label?.startsWith("尺寸"))).toBe(false);
    });

    it("内核返回非 0 code 时把大小与修改时间整行收起来，已确定的行保持可见", () => {
        respondWith(null, 1);
        const menu = installMenu();
        harness.emitBus("open-menu-image", {element: pngOf()});

        return Promise.resolve().then(() => {
            const items = itemsOf(menu);
            const sizeElement = render(items[1]);
            const typeElement = render(items[2]);
            const modifiedElement = render(items[3]);
            // 拿不到数据就不留「读取中」这种残迹
            expect(sizeElement.classList.contains("fn__none")).toBe(true);
            expect(modifiedElement.classList.contains("fn__none")).toBe(true);
            expect(typeElement.classList.contains("fn__none")).toBe(false);
            expect(labelOf(typeElement)).toBe("类型: PNG");
        });
    });

    it("请求走错误回调时同样收起这两行", () => {
        failViaErrorCallback();
        const menu = installMenu();
        harness.emitBus("open-menu-image", {element: pngOf()});

        return Promise.resolve().then(() => {
            const items = itemsOf(menu);
            expect(render(items[1]).classList.contains("fn__none")).toBe(true);
            expect(render(items[3]).classList.contains("fn__none")).toBe(true);
        });
    });

    it("请求本身 reject 时也不抛，按「没拿到」处理", async () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            async () => {
                throw new Error("network down");
            },
        );
        const menu = installMenu();

        expect(() => harness.emitBus("open-menu-image", {element: pngOf()})).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();

        const items = itemsOf(menu);
        expect(render(items[1]).classList.contains("fn__none")).toBe(true);
        expect(render(items[3]).classList.contains("fn__none")).toBe(true);
    });

    it("外链图片与 data URI 都不算工作区资源，菜单里什么都不加", () => {
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: pngOf("https://example.com/a.png")});
        harness.emitBus("open-menu-image", {element: pngOf("data:image/png;base64,AAAA")});

        expect(itemsOf(menu)).toEqual([]);
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });

    it("图片优先取 data-src（加密笔记本里带 ?box= 的那个）", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const image = pngOf("assets/plain.png");
        image.setAttribute("data-src", "assets/encrypted.png?box=20240101");
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: image});

        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({path: "assets/encrypted.png?box=20240101"});
        // 类型取的是去掉查询串之后的名字，扩展名不会被 ?box= 带偏
        expect(itemsOf(menu).some((item) => item.label === "类型: PNG")).toBe(true);
    });

    it("行内链接菜单：从 data-href 取资源路径", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const link = document.createElement("span");
        link.setAttribute("data-type", "a");
        link.setAttribute("data-href", "assets/contract.pdf");
        const menu = installMenu();

        harness.emitBus("open-menu-link", {element: link});

        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({path: "assets/contract.pdf"});
        expect(itemsOf(menu).some((item) => item.label === "类型: PDF")).toBe(true);
    });

    it("行内链接指向外链时忽略", () => {
        const link = document.createElement("span");
        link.setAttribute("data-type", "a");
        link.setAttribute("data-href", "https://example.com");
        const menu = installMenu();

        harness.emitBus("open-menu-link", {element: link});

        expect(itemsOf(menu)).toEqual([]);
    });

    it("块标菜单：资源块本身（video / audio / iframe）与包含资源的容器块都认", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const video = document.createElement("video");
        video.setAttribute("src", "assets/clip.mp4");

        const first = installMenu();
        harness.emitBus("click-blockicon", {blockElements: [video]});
        expect(itemsOf(first).some((item) => item.label === "类型: MP4")).toBe(true);

        const block = document.createElement("div");
        block.innerHTML = '<audio src="assets/voice.mp3"></audio>';
        const second = installMenu();
        harness.emitBus("click-blockicon", {blockElements: [block]});
        expect(itemsOf(second).some((item) => item.label === "类型: MP3")).toBe(true);

        const frame = document.createElement("div");
        frame.innerHTML = '<iframe src="assets/panel.html"></iframe>';
        const third = installMenu();
        harness.emitBus("click-blockicon", {blockElements: [frame]});
        expect(itemsOf(third).some((item) => item.label === "类型: HTML")).toBe(true);
    });

    it("块标菜单只认第一个块，且没有块元素时什么都不加", () => {
        const menu = installMenu();

        harness.emitBus("click-blockicon", {});
        harness.emitBus("click-blockicon", {blockElements: []});

        expect(itemsOf(menu)).toEqual([]);
    });

    it("没有正在构建的菜单时不抛，也不留下任何记录", () => {
        // 事件被派发时菜单还没开始拼（或已经关掉），此时没有可以加行的对象
        (window.siyuan as unknown as {menus?: unknown;}).menus = undefined;

        expect(() => harness.emitBus("open-menu-image", {element: pngOf()})).not.toThrow();
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });

    it("拿不到扩展名时不出类型行（无后缀 / 只有点开头的隐藏文件）", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const plain = installMenu();
        harness.emitBus("open-menu-image", {element: pngOf("assets/README")});
        expect(itemsOf(plain).some((item) => item.label?.startsWith("类型"))).toBe(false);

        // `.gitignore` 的最后一个点在 0 位，说明没有扩展名
        const hidden = installMenu();
        harness.emitBus("open-menu-image", {element: pngOf("assets/.gitignore")});
        expect(itemsOf(hidden).some((item) => item.label?.startsWith("类型"))).toBe(false);
    });

    it("扩展名统一大写，带查询串也不影响", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: pngOf("assets/photo.JpEg?v=2")});

        expect(itemsOf(menu).some((item) => item.label === "类型: JPEG")).toBe(true);
    });

    it("图片与资源块同时存在时只认图片那一条", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const block = document.createElement("div");
        block.innerHTML = '<img src="assets/cover.png"><video src="assets/clip.mp4"></video>';
        const menu = installMenu();

        harness.emitBus("click-blockicon", {blockElements: [block]});

        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({path: "assets/cover.png"});
        expect(itemsOf(menu).some((item) => item.label === "类型: PNG")).toBe(true);
    });

    it("连续打开两次菜单各加各的，互不覆盖", () => {
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        const menu = installMenu();

        harness.emitBus("open-menu-image", {element: pngOf("assets/a.png")});
        const count = itemsOf(menu).length;
        harness.emitBus("open-menu-image", {element: pngOf("assets/b.jpg")});

        expect(itemsOf(menu).length).toBe(count * 2);
        expect(mockState.fetchPost.mock.calls[1][1]).toEqual({path: "assets/b.jpg"});
    });

    it("卸载后事件总线不再响应", () => {
        const menu = installMenu();
        harness.dispose();

        harness.emitBus("open-menu-image", {element: pngOf()});

        expect(itemsOf(menu)).toEqual([]);
    });
});
