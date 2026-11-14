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
    "feature.refCrumbsGuide.openAction": "打开设置",
    "feature.refCrumbsGuide.installAction": "去集市页面",
    "feature.refCrumbsGuide.bazaarUnavailable": "本设备已关闭集市，打不开它的集市页面",
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

describe("「引用面包屑」插件引导", () => {
    it("目标插件已启用时，按钮文字是「打开设置」", () => {
        setPlugins([{name: TARGET, openSetting: vi.fn()}]);

        // 文案是「这一行现在能做什么」，装了却还写「去集市安装」会把人引到错的地方
        expect(refCrumbsActionLabel(context())).toBe("打开设置");
    });

    it("目标插件没装时，按钮文字是「去集市页面」", () => {
        setPlugins([]);

        expect(refCrumbsActionLabel(context())).toBe("去集市页面");
    });

    it("只认目标包名：别的插件在场不算「装了」", () => {
        setPlugins([{name: "other-plugin", openSetting: vi.fn()}, {name: `${TARGET}-beta`}]);

        // 名字只是前缀相同也要当没装，否则会去调一个不存在的 openSetting
        expect(refCrumbsActionLabel(context())).toBe("去集市页面");
    });

    it("i18n 缺这个 key 时回落成 key 本身，不抛也不显示空白", () => {
        setPlugins([]);
        const bare = createActionContext({featureId: "ref-crumbs-guide"}).context;

        expect(refCrumbsActionLabel(bare)).toBe("feature.refCrumbsGuide.installAction");
    });

    it("已启用：直接调目标插件自己的 openSetting，不碰集市", () => {
        const openSetting = vi.fn();
        setPlugins([{name: TARGET, openSetting}]);

        openRefCrumbs(context());

        // 官方 API 只有插件实例自己的 openSetting；跳集市那条路是退路，不该同时走
        expect(openSetting).toHaveBeenCalledTimes(1);
        expect(openByMobile).not.toHaveBeenCalled();
        expect(mockState.messages).toHaveLength(0);
    });

    it("没装 + 桌面端：交给思源的 siyuan:// 协议，地址精确到包的 readme", () => {
        setPlugins([]);

        openRefCrumbs(context());

        // 集市没有官方插件 API，只能用协议；`readme` 是包没装时也有内容的那个形态
        expect(openByMobile).toHaveBeenCalledTimes(1);
        expect(openByMobile).toHaveBeenCalledWith(BAZAAR_URI);
        expect(mockState.messages).toHaveLength(0);
    });

    it("没装 + 移动端且集市可用：同样走协议", () => {
        mockState.frontend = "mobile";
        setDisabledFeatures([]);
        setPlugins([]);

        openRefCrumbs(context());

        expect(openByMobile).toHaveBeenCalledWith(BAZAAR_URI);
        expect(mockState.messages).toHaveLength(0);
    });

    it("移动端关掉了集市：提前拦一句提示，不去发一个必然被拒的协议", () => {
        mockState.frontend = "mobile";
        setDisabledFeatures(["bazaar", "assets"]);
        setPlugins([]);

        openRefCrumbs(context());

        // 不发提示的话用户点了什么都没发生，看起来就是按钮坏了
        expect(openByMobile).not.toHaveBeenCalled();
        expect(mockState.messages).toEqual([
            {text: "本设备已关闭集市，打不开它的集市页面", timeout: 4000, type: undefined},
        ]);
    });

    it("桌面端不看 disabledFeatures：那里的集市由内核自己处理", () => {
        mockState.frontend = "desktop";
        setDisabledFeatures(["bazaar"]);
        setPlugins([]);

        openRefCrumbs(context());

        // 源码只对 `mobile` 判这一项（见 bazaarAvailable），桌面端一律走协议
        expect(openByMobile).toHaveBeenCalledWith(BAZAAR_URI);
    });

    it("判定不缓存：先没装、后装上，同一份上下文立刻换行为", () => {
        setPlugins([]);
        expect(refCrumbsActionLabel(context())).toBe("去集市页面");

        const openSetting = vi.fn();
        setPlugins([{name: TARGET, openSetting}]);

        // 各插件是逐条串行加载的，缓存 onload 那一刻的结论会让这一行永远停在旧文案
        expect(refCrumbsActionLabel(context())).toBe("打开设置");
        openRefCrumbs(context());
        expect(openSetting).toHaveBeenCalledTimes(1);
        expect(openByMobile).not.toHaveBeenCalled();
    });

    it("声明：永不挂载、没有配置项，只由说明块 + 一颗动作按钮组成", () => {
        expect(definition.id).toBe("ref-crumbs-guide");
        expect(definition.category).toBe("editor");
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
