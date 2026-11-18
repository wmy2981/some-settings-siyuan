/**
 * 「关于本插件」（plugin-reminder）。
 *
 * 一块说明文字加两颗外链按钮：去 GitHub 点星、给开发者捐赠。文字里的版本号与仓库地址
 * 都来自插件清单，链接显示成 `owner/repo` 短写；两颗按钮都走 `core/link.ts` 的
 * 同一个入口，这样本插件自己的「外链跳转前确认」才会像对待其它外链一样拦下它们。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import manifest from "../../plugin.json";
import type {FeatureActionContext} from "../../src/core/types";
import definition from "../../src/features/plugin-reminder/index";
import {
    DONATE_ICON,
    hasDonateUrl,
    openDonate,
    openRepository,
} from "../../src/features/plugin-reminder/links";
import {createActionContext} from "../helpers/feature-host";

/** 让 `openExternalLink` 的插件广播拿到一组「有 eventBus 的插件」。 */
const setPlugins = (plugins: {eventBus?: {emit: (type: string, detail: unknown) => boolean;};}[]): void => {
    (window.siyuan as unknown as {ws: {app: {plugins: unknown[];};};}).ws.app.plugins = plugins;
};

const noteField = () => definition.settings[0] as Extract<typeof definition.settings[number], {kind: "note";}>;

const actionsOf = () => noteField().actions ?? [];

const actionContext = (): FeatureActionContext => createActionContext({featureId: "plugin-reminder"}).context;

afterEach(() => {
    vi.doUnmock("../../plugin.json");
    vi.resetModules();
});

describe("about this plugin", () => {
    it("the note carries version and repository placeholders, with the repository shown in owner/repo short form", () => {
        // 版本与地址不写死在文案里，避免多出一份迟早会过期的副本
        const note = noteField();
        expect(note.kind).toBe("note");
        expect(note.key).toBe("notice");
        expect(note.text).toBe("feature.pluginReminder.notice");
        expect(note.values).toEqual({version: manifest.version, repo: manifest.url});
        expect(note.labels).toEqual({repo: "wmy2981/some-settings-siyuan"});
    });

    it("two buttons: star first (theme colour + GitHub icon), then donate (pink + official SVG)", () => {
        const actions = actionsOf();
        expect(actions.map((action) => action.key)).toEqual(["star", "donate"]);
        expect(actions[0]).toMatchObject({
            label: "feature.pluginReminder.starAction",
            appearance: "block",
            tone: "primary",
            icon: "iconGithub",
        });
        expect(actions[0].iconSvg).toBeUndefined();
        expect(actions[1]).toMatchObject({
            label: "feature.pluginReminder.donateAction",
            appearance: "block",
            tone: "pink",
        });
        expect(actions[1].iconSvg).toBe(DONATE_ICON);
        // 那颗爱心没有对应的内置 symbol，只能是现成的 SVG 标记
        expect(actions[1].icon).toBeUndefined();
    });

    it("the donate icon is the 32×32 image from SiYuan's about page", () => {
        expect(DONATE_ICON).toContain('<svg version="1.1"');
        expect(DONATE_ICON).toContain('width="32" height="32"');
        expect(DONATE_ICON).toContain('viewBox="0 0 32 32"');
        // 只有一张图，不是一整段带文字的按钮
        expect(DONATE_ICON).not.toContain("<text");
        expect(DONATE_ICON.trimEnd().endsWith("</svg>")).toBe(true);
    });

    it("the donate button only appears when the manifest has a funding link", () => {
        expect(manifest.funding?.custom?.[0]).toBe("https://afdian.com/a/wmy2981");
        expect(hasDonateUrl()).toBe(true);
    });

    it("star opens the repository URL from the manifest", () => {
        openRepository();
        expect(window.open).toHaveBeenCalledWith(manifest.url, "_blank");
    });

    it("donate opens the first custom funding link in the manifest", () => {
        openDonate();
        expect(window.open).toHaveBeenCalledWith("https://afdian.com/a/wmy2981", "_blank");
    });

    it("the buttons' onClick really calls these two entry points (the buttons are not just drawn)", () => {
        // 面板自己画的按钮走不到内核那条 openLink 路，接错函数就等于点不动
        const actions = actionsOf();
        actions[0].onClick(actionContext());
        actions[1].onClick(actionContext());

        expect(window.open).toHaveBeenNthCalledWith(1, manifest.url, "_blank");
        expect(window.open).toHaveBeenNthCalledWith(2, "https://afdian.com/a/wmy2981", "_blank");
    });

    it("no window opens when another plugin vetoes open-link", () => {
        // 本插件自己的「外链跳转前确认」正是这样拦下外链的：面板入口必须同样经过它
        const emit = vi.fn(() => false);
        setPlugins([{eventBus: {emit}}]);

        openRepository();

        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith("open-link", {
            href: manifest.url,
            originalHref: manifest.url,
            event: undefined,
        });
        expect(window.open).not.toHaveBeenCalled();
    });

    it("plugins are asked in registration order and a single veto stops the open", () => {
        const first = vi.fn(() => true);
        const second = vi.fn(() => false);
        const third = vi.fn(() => true);
        setPlugins([{eventBus: {emit: first}}, {eventBus: {emit: second}}, {eventBus: {emit: third}}]);

        openDonate();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        // 已经被拦下，后面的插件不必再问
        expect(third).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
    });

    it("without a veto the host opens the link as usual", () => {
        setPlugins([{eventBus: {emit: () => true}}, {}]);
        openDonate();
        expect(window.open).toHaveBeenCalledWith("https://afdian.com/a/wmy2981", "_blank");
    });

    it("never mounts: only a note block, no runtime behaviour", () => {
        expect(definition.enabled).toBe(true);
        expect(definition.isEnabled!({})).toBe(false);
        expect(definition.mount).toBeUndefined();
        expect(definition.category).toBe("plugin");
    });

    it("without a funding link in the manifest the button is absent and openDonate is a no-op", async () => {
        // 换掉清单再重新导入：`hasDonateUrl` 与按钮列表都是模块加载时按清单算出来的
        vi.doMock("../../plugin.json", () => ({
            default: {
                version: "9.9.9",
                url: "https://github.com/foo/bar.git",
            },
        }));
        vi.resetModules();

        const links = await import("../../src/features/plugin-reminder/links");
        const reminder = (await import("../../src/features/plugin-reminder/index")).default;
        const note = reminder.settings[0] as Extract<typeof reminder.settings[number], {kind: "note";}>;

        expect(links.hasDonateUrl()).toBe(false);
        expect(note.actions!.map((action) => action.key)).toEqual(["star"]);
        expect(note.values).toEqual({version: "9.9.9", repo: "https://github.com/foo/bar.git"});

        links.openDonate();
        expect(window.open).not.toHaveBeenCalled();
    });

    it("the short form strips www., .git and the trailing slash", async () => {
        const shortOf = async (url: string): Promise<string> => {
            vi.doMock("../../plugin.json", () => ({
                default: {version: "1.0.0", url, funding: {custom: ["https://example.com/donate"]}},
            }));
            vi.resetModules();
            const reminder = (await import("../../src/features/plugin-reminder/index")).default;
            const note = reminder.settings[0] as Extract<typeof reminder.settings[number], {kind: "note";}>;
            return note.labels!.repo;
        };

        expect(await shortOf("https://www.github.com/foo/bar.git")).toBe("foo/bar");
        expect(await shortOf("https://github.com/foo/bar/")).toBe("foo/bar");
        // 已知边界：实现先剥 `.git` 再去尾斜杠，所以 `.git/` 这种组合只剥掉斜杠。
        // 如实锁定现状 —— 改这段逻辑时这条断言会先拦住，提醒去确认新结果。
        expect(await shortOf("https://github.com/foo/bar.git/")).toBe("foo/bar.git");
    });

    it("with another manifest the placeholders follow it and the donate button follows its funding link", async () => {
        vi.doMock("../../plugin.json", () => ({
            default: {
                version: "1.0.0",
                url: "https://www.github.com/foo/bar.git/",
                funding: {custom: ["https://example.com/donate"]},
            },
        }));
        vi.resetModules();

        const reminder = (await import("../../src/features/plugin-reminder/index")).default;
        const note = reminder.settings[0] as Extract<typeof reminder.settings[number], {kind: "note";}>;

        expect(note.values!.repo).toBe("https://www.github.com/foo/bar.git/");
        expect(note.values!.version).toBe("1.0.0");
        // 捐赠地址取自清单，换一份清单就跟着换
        expect(note.actions!.map((action) => action.key)).toEqual(["star", "donate"]);
    });
});
