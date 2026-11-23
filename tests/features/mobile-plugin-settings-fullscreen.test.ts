/**
 * 移动端插件设置抽屉默认全屏（`mobile-plugin-settings-fullscreen`）的单元测试。
 *
 * 这个功能不改宿主的内联高度，只给抽屉打一个标记类，由一段带 `!important` 的 CSS 压过
 * 宿主的半屏内联值 —— 所以断言分四层：声明形状、注入的 CSS 文本、哪些抽屉会被认出来
 * （插件显示名 / 插件名对得上标题的抽屉，且只在抽屉上），以及卸载后的干净退出。
 *
 * 最关键的一条是「内联高度一个字节都不动」：另一支功能（`mobile-sheet-auto-height`）
 * 会反复改写同一批内联值，两边都写就会互相触发观察器、来回抢，所以这里必须证明我们只加类。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import definition from "../../src/features/mobile-plugin-settings-fullscreen/index";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

const MARK = "ss-plugin-settings-fullscreen";
/** 宿主默认按「半屏」写进内联样式的高度。 */
const HALF = 384;

const tick = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

/** 装一批本机插件：显示名用于默认设置面板，插件名用于自定义标题的面板。 */
const stubPlugins = (plugins: {displayName?: string; name?: string;}[] = [
    {displayName: "Some Plugin", name: "some-plugin"},
    {displayName: "一些设置", name: "some-settings-siyuan"},
]): void => {
    Object.defineProperty(window, "siyuan", {
        configurable: true,
        writable: true,
        value: {ws: {app: {plugins}}},
    });
};

interface SheetFixture {
    /** 宿主的对话框外层，`mobile-bottom-sheet-dialog` 挂在这里。 */
    dialog: HTMLElement;
    /** 抽屉本体，宿主在它身上写内联高度。 */
    sheet: HTMLElement;
}

/**
 * 造一个宿主刚摆好的插件设置抽屉。
 *
 * `title` 就是 `Setting.open()` 写进标题的插件名；不传表示没有标题节点（不该被认出来）。
 */
const sheet = (title?: string, height = HALF): SheetFixture => {
    const dialog = document.createElement("div");
    dialog.className = "mobile-bottom-sheet-dialog";
    const overlay = document.createElement("div");
    overlay.className = "b3-dialog mobile-sheet-layout";
    const panel = document.createElement("div");
    panel.className = "b3-dialog__container mobile-sheet-panel";
    panel.style.height = `${height}px`;
    panel.style.maxHeight = `${height}px`;
    if (title !== undefined) {
        const header = document.createElement("div");
        header.className = "resize__move b3-dialog__header";
        header.textContent = title;
        panel.append(header);
    }
    const body = document.createElement("div");
    body.className = "b3-dialog__body";
    panel.append(body);
    overlay.append(panel);
    dialog.append(overlay);
    document.body.append(dialog);
    return {dialog, sheet: panel};
};

describe("Plugin settings drawers open full screen on mobile", () => {
    let harness: HostHarness | undefined;

    afterEach(() => {
        harness?.dispose();
        harness = undefined;
        document.body.innerHTML = "";
        delete (window as unknown as {siyuan?: unknown;}).siyuan;
    });

    const mount = (): HostHarness => {
        harness = mountFeature(definition);
        return harness;
    };

    it("Declaration: marketplace and appearance, mobile only, drawers from 3.8.12-alpha.2, one switch off by default", () => {
        expect(definition.id).toBe("mobile-plugin-settings-fullscreen");
        expect(definition.category).toEqual(["bazaar", "appearance"]);
        expect(definition.frontends).toEqual(["mobile"]);
        expect(definition.minAppVersion).toBe("3.8.12-alpha.2");
        expect(definition.enabled).toBe(true);
        expect(configKeysOf(definition.settings)).toEqual(["enabled"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.mount).toBeTypeOf("function");
    });

    it("Covers the host's inline half-height with an important height on the marked drawer", () => {
        stubPlugins();
        const mounted = mount();
        const css = mounted.css();

        expect(css).toContain(`.mobile-bottom-sheet-dialog .b3-dialog__container.${MARK}`);
        expect(css).toContain("height: 100% !important;");
        expect(css).toContain("max-height: 100% !important;");
        expect(mounted.styleElement()).not.toBeNull();
    });

    it("Marks the drawer whose title is an installed plugin's display name", async () => {
        stubPlugins();
        mount();
        const {sheet: panel} = sheet("Some Plugin");
        await tick();

        expect(panel.classList.contains(MARK)).toBe(true);
        expect(harness?.records.logs.at(-1)?.[0] as string).toContain("Some Plugin");
    });

    it("Marks a drawer titled with the plugin package name too", async () => {
        stubPlugins();
        mount();
        const {sheet: panel} = sheet("some-settings-siyuan");
        await tick();

        expect(panel.classList.contains(MARK)).toBe(true);
    });

    it("Marks a drawer that was already open when the feature mounted", () => {
        stubPlugins();
        const {sheet: panel} = sheet("Some Plugin");
        mount();

        expect(panel.classList.contains(MARK)).toBe(true);
    });

    it("Leaves dialogs owned by the host alone", async () => {
        stubPlugins();
        mount();
        const exported = sheet("导出");
        const confirm = sheet("确认");
        await tick();

        expect(exported.sheet.classList.contains(MARK)).toBe(false);
        expect(confirm.sheet.classList.contains(MARK)).toBe(false);
    });

    it("Ignores a drawer without a title", async () => {
        stubPlugins();
        mount();
        const {sheet: panel} = sheet();
        await tick();

        expect(panel.classList.contains(MARK)).toBe(false);
    });

    it("Never touches a plain dialog container", async () => {
        stubPlugins();
        mount();
        const overlay = document.createElement("div");
        overlay.className = "b3-dialog";
        const container = document.createElement("div");
        const header = document.createElement("div");
        header.className = "b3-dialog__header";
        header.textContent = "Some Plugin";
        container.append(header);
        overlay.append(container);
        document.body.append(overlay);
        await tick();

        expect(container.classList.contains(MARK)).toBe(false);
    });

    it("Writes no inline height, even after the host rewrites it", async () => {
        stubPlugins();
        mount();
        const {sheet: panel} = sheet("Some Plugin");
        await tick();

        // 宿主重算高度：这里只许看着，不许跟着写
        panel.style.height = `${HALF}px`;
        panel.style.maxHeight = `${HALF}px`;
        await tick();

        expect(panel.style.height).toBe(`${HALF}px`);
        expect(panel.style.maxHeight).toBe(`${HALF}px`);
        expect(panel.classList.contains(MARK)).toBe(true);
    });

    it("Says so when the host lists no plugin", () => {
        stubPlugins([]);
        mount();

        expect(harness?.records.logLevels).toContain("warn");
    });

    it("Releases the mark and stops watching after unmount", async () => {
        stubPlugins();
        const mounted = mount();
        const {sheet: panel} = sheet("Some Plugin");
        await tick();
        expect(panel.classList.contains(MARK)).toBe(true);

        mounted.dispose();
        harness = undefined;
        const later = sheet("Some Plugin");
        await tick();

        expect(panel.classList.contains(MARK)).toBe(false);
        expect(later.sheet.classList.contains(MARK)).toBe(false);
    });
});
