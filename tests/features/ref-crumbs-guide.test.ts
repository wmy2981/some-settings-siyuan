/**
 * 「引用面包屑」插件引导（ref-crumbs-guide）。
 *
 * 这一行只是指路：目标插件装了就直接开它自己的设置面板，没装就去集市里它的详情页。
 * 它没有 mount、不读写配置，全部行为都在 `label` 与 `onClick` 两个函数里，
 * 所以用 `createActionContext()` 直接驱动，而不是按挂载测试。
 *
 * 两条判定都必须在「用户点的时候」「面板每次打开的时候」现取：各插件是逐条串行加载的，
 * 本插件 onload 时别的插件可能还没加载完，缓存结论会让这一行一直停在「去集市安装」。
 */
import {platformUtils} from "siyuan";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureActionContext} from "../../src/core/types";
import {
    openRefCrumbs,
    refCrumbsActionLabel,
} from "../../src/features/ref-crumbs-guide/guide";
import definition from "../../src/features/ref-crumbs-guide/index";
import {
    configKeysOf,
    createActionContext,
} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** 目标插件的包名。 */
const TARGET = "ref-crumbs-siyuan";
/** 集市详情页地址：思源 `siyuan://` 协议里唯一定位到某个包的形态。 */
const BAZAAR_URI = `siyuan://bazaar/plugins/${TARGET}/readme`;

const TEXT: Record<string, string> = {
    "feature.refCrumbsGuide.openAction": "Open settings",
    "feature.refCrumbsGuide.installAction": "Go to the Bazaar page",
    "feature.refCrumbsGuide.bazaarUnavailable": "The Bazaar is disabled on this device, its page cannot be opened",
};

const translate = (key: string): string => TEXT[key] ?? key;

/**
 * `tests/mocks/siyuan.ts` 的 `platformUtils` 只有三个前端判别函数，没有 `openByMobile`；
 * 这里在同一个对象上补一个（功能就是从这个模块取它的），用完删掉，不污染别的测试文件。
 */
const openByMobile = vi.fn();

const context = (): FeatureActionContext =>
    createActionContext({
        featureId: "ref-crumbs-guide",
        i18n: translate,
    }).context;

const setPlugins = (plugins: {name: string; openSetting?: () => void;}[]): void => {
    (window.siyuan as unknown as {ws: {app: {plugins: unknown[];};};}).ws.app.plugins = plugins;
};

const setDisabledFeatures = (features: string[]): void => {
    (window.siyuan as unknown as {config: {system: {disabledFeatures?: string[];};};}).config.system.disabledFeatures =
        features;
};

beforeEach(() => {
    (platformUtils as unknown as {openByMobile?: unknown;}).openByMobile = openByMobile;
});

afterEach(() => {
    delete (platformUtils as unknown as {openByMobile?: unknown;}).openByMobile;
    openByMobile.mockReset();
});

describe("ref-crumbs plugin guide", () => {
    it("the button reads open-settings when the target plugin is enabled", () => {
        setPlugins([{name: TARGET, openSetting: vi.fn()}]);

        // 文案是「这一行现在能做什么」，装了却还写「去集市安装」会把人引到错的地方
        expect(refCrumbsActionLabel(context())).toBe("Open settings");
    });

    it("the button reads go-to-bazaar when the target plugin is missing", () => {
        setPlugins([]);

        expect(refCrumbsActionLabel(context())).toBe("Go to the Bazaar page");
    });

    it("only the target package name counts: other plugins present do not mean installed", () => {
        setPlugins([{name: "other-plugin", openSetting: vi.fn()}, {name: `${TARGET}-beta`}]);

        // 名字只是前缀相同也要当没装，否则会去调一个不存在的 openSetting
        expect(refCrumbsActionLabel(context())).toBe("Go to the Bazaar page");
    });

    it("a missing i18n key falls back to the key itself, neither throwing nor rendering blank", () => {
        setPlugins([]);
        const bare = createActionContext({featureId: "ref-crumbs-guide"}).context;

        expect(refCrumbsActionLabel(bare)).toBe("feature.refCrumbsGuide.installAction");
    });

    it("enabled: calls the target plugin's own openSetting and never touches the Bazaar", () => {
        const openSetting = vi.fn();
        setPlugins([{name: TARGET, openSetting}]);

        openRefCrumbs(context());

        // 官方 API 只有插件实例自己的 openSetting；跳集市那条路是退路，不该同时走
        expect(openSetting).toHaveBeenCalledTimes(1);
        expect(openByMobile).not.toHaveBeenCalled();
        expect(mockState.messages).toHaveLength(0);
    });

    it("not installed on desktop: hands over to the siyuan:// protocol, with the address pointing at the package readme", () => {
        setPlugins([]);

        openRefCrumbs(context());

        // 集市没有官方插件 API，只能用协议；`readme` 是包没装时也有内容的那个形态
        expect(openByMobile).toHaveBeenCalledTimes(1);
        expect(openByMobile).toHaveBeenCalledWith(BAZAAR_URI);
        expect(mockState.messages).toHaveLength(0);
    });

    it("not installed on mobile with the Bazaar available: uses the protocol too", () => {
        mockState.frontend = "mobile";
        setDisabledFeatures([]);
        setPlugins([]);

        openRefCrumbs(context());

        expect(openByMobile).toHaveBeenCalledWith(BAZAAR_URI);
        expect(mockState.messages).toHaveLength(0);
    });

    it("Bazaar disabled on mobile: warns up front instead of firing a protocol call that must fail", () => {
        mockState.frontend = "mobile";
        setDisabledFeatures(["bazaar", "assets"]);
        setPlugins([]);

        openRefCrumbs(context());

        // 不发提示的话用户点了什么都没发生，看起来就是按钮坏了
        expect(openByMobile).not.toHaveBeenCalled();
        expect(mockState.messages).toEqual([
            {text: "The Bazaar is disabled on this device, its page cannot be opened", timeout: 4000, type: undefined},
        ]);
    });

    it("desktop ignores disabledFeatures: the Bazaar there is the kernel's own business", () => {
        mockState.frontend = "desktop";
        setDisabledFeatures(["bazaar"]);
        setPlugins([]);

        openRefCrumbs(context());

        // 源码只对 `mobile` 判这一项（见 bazaarAvailable），桌面端一律走协议
        expect(openByMobile).toHaveBeenCalledWith(BAZAAR_URI);
    });

    it("no caching: installed later, the same context changes behaviour at once", () => {
        setPlugins([]);
        expect(refCrumbsActionLabel(context())).toBe("Go to the Bazaar page");

        const openSetting = vi.fn();
        setPlugins([{name: TARGET, openSetting}]);

        // 各插件是逐条串行加载的，缓存 onload 那一刻的结论会让这一行永远停在旧文案
        expect(refCrumbsActionLabel(context())).toBe("Open settings");
        openRefCrumbs(context());
        expect(openSetting).toHaveBeenCalledTimes(1);
        expect(openByMobile).not.toHaveBeenCalled();
    });

    it("declaration: never mounts, has no config, and is a note plus one action button", () => {
        expect(definition.id).toBe("ref-crumbs-guide");
        expect(definition.category).toEqual(["editor"]);
        expect(definition.enabled).toBe(true);
        // 没有运行期行为，所以显式「永不启用」，而不是加一个点了也没用的开关
        expect(definition.isEnabled?.({})).toBe(false);
        expect(definition.mount).toBeUndefined();
        expect(configKeysOf(definition.settings)).toEqual([]);

        const [note, button] = definition.settings;
        expect(note).toMatchObject({kind: "note", key: "notice", text: "feature.refCrumbsGuide.notice"});
        expect(button).toMatchObject({
            kind: "button",
            key: "open",
            title: "feature.refCrumbsGuide.actionTitle",
            description: "feature.refCrumbsGuide.actionTip",
        });
        // 文案与点击都是导出的那两个函数本身：装没装决定文案，行为跟着同一份判定走
        expect((button as {label: unknown;}).label).toBe(refCrumbsActionLabel);
        expect((button as {onClick: unknown;}).onClick).toBe(openRefCrumbs);
    });
});
