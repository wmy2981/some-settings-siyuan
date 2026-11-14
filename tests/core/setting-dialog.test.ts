/**
 * `core/setting-dialog.ts`：插件设置面板。
 *
 * 面板的行为可以归成三件事，这里按这三块组织：
 * - 渲染：分类 → 页签，功能 → 功能行（开关跟名字走），字段 → 控件；
 * - 落盘：控件改完即写（文本 / 数字按静默期合并），写失败时控件回到磁盘上的值；
 * - 宿主交互：只读模式、动作行、说明块外链、布局与宽度、卸载清理。
 */
import type {Plugin} from "siyuan";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {ConfigStore} from "../../src/core/config";
import {setDetailedLogging} from "../../src/core/log";
import {SettingsPanel} from "../../src/core/setting-dialog";
import type {
    FeatureDefinition,
    SettingField,
} from "../../src/core/types";
import type {FeatureActionContext} from "../../src/core/types";
import {mockState} from "../mocks/siyuan";

const PANEL_CLASS = "some-settings-panel";

/** 宿主播件：存储放在 Map 里，可注入写盘失败。 */
class FakeHost {
    readonly name = "some-settings-siyuan";
    readonly displayName = "some settings";
    readonly files = new Map<string, unknown>();
    rejectWrites = false;
    i18n: Record<string, string> = {
        "alpha.name": "甲功能",
        "alpha.desc": "甲的说明",
        "alpha.enabled": "启用甲",
        "alpha.enabled.desc": "开关说明",
        "alpha.size": "尺寸",
        "alpha.label": "标签",
        "alpha.label.ph": "请输入标签",
        "alpha.mode": "方式",
        "alpha.auto": "自动",
        "alpha.manual": "手动",
        "alpha.about": "版本 {version}\n仓库 {repo}",
        "alpha.repo": "项目仓库",
        "alpha.run": "执行",
        "alpha.runLabel": "点我执行",
        "area.name": "丁功能",
        "area.authors": "作者名单",
        "area.authors.desc": "一行一个作者",
        "area.authors.ph": "作者占位",
        "secondary.name": "乙功能",
        "switch-mode.name": "丙功能",
        "switch-mode.scope": "适用端",
        "switch-mode.off": "禁用",
        "switch-mode.on": "启用",
        "category.editor": "编辑",
        "category.appearance": "外观",
        "category.settings": "设置",
        "common.enabled": "启用",
        "panel.empty": "本宿主没有可用的设置项",
        "panel.search.placeholder": "搜索...",
        "panel.search.clear": "清空搜索",
        "panel.search.empty": "无结果",
        "panel.readonlyTip": "只读工作空间",
        "action.done": "动作已执行",
    };

    loadData = vi.fn(async (name: string): Promise<unknown> => this.files.get(name) ?? "");
    saveData = vi.fn(async (name: string, value: unknown): Promise<unknown> => {
        if (this.rejectWrites) {
            return {code: 1, msg: "readonly"};
        }
        this.files.set(name, JSON.parse(JSON.stringify(value)));
        return {code: 0};
    });
    removeData = vi.fn(async (name: string): Promise<unknown> => {
        this.files.delete(name);
        return {code: 0};
    });

    asPlugin(): Plugin {
        return this as unknown as Plugin;
    }
}

const alphaSettings = (onClick: (context: FeatureActionContext) => void = () => undefined): SettingField[] => [
    {kind: "switch", key: "enabled", title: "alpha.enabled", description: "alpha.enabled.desc", default: false},
    {kind: "number", key: "size", title: "alpha.size", default: 12, min: 8, max: 24, unit: "px"},
    {kind: "text", key: "label", title: "alpha.label", placeholder: "alpha.label.ph", default: "hi"},
    {
        kind: "select",
        key: "mode",
        title: "alpha.mode",
        default: "auto",
        options: [{value: "auto", label: "alpha.auto"}, {value: "manual", label: "alpha.manual"}],
    },
    {
        kind: "note",
        key: "about",
        text: "alpha.about",
        values: {version: "1.0.1", repo: "https://github.com/wmy2981/some-settings-siyuan"},
        labels: {repo: "owner/repo"},
    },
    {kind: "button", key: "run", title: "alpha.run", label: "alpha.runLabel", onClick},
];

const featureOf = (id: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
    id,
    category: "editor",
    name: `${id}.name`,
    description: `${id}.desc`,
    enabled: true,
    settings: alphaSettings(),
    ...extra,
});

interface Opened {
    host: FakeHost;
    store: ConfigStore;
    panel: SettingsPanel;
    /** 对话框根元素。 */
    root: HTMLElement;
    /** 面板根元素（`.some-settings-panel`）。 */
    panelElement: HTMLElement;
    q: <T extends HTMLElement>(selector: string) => T | null;
    qa: (selector: string) => HTMLElement[];
}

/** 建 store、注册功能、打开面板。 */
const open = async (
    definitions: FeatureDefinition[] = [featureOf("alpha")],
    stored: Record<string, unknown> = {},
    existingHost?: FakeHost,
): Promise<Opened> => {
    const host = existingHost ?? new FakeHost();
    Object.entries(stored).forEach(([id, value]) => host.files.set(`feature-${id}`, value));
    const store = new ConfigStore(host.asPlugin());
    for (const definition of definitions) {
        await store.register(definition);
    }
    const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: definitions});
    panel.show();
    const root = mockState.settings[mockState.settings.length - 1]?.dialog?.element;
    if (!root) {
        throw new Error("panel did not open");
    }
    const panelElement = root.querySelector<HTMLElement>(`.${PANEL_CLASS}`) as HTMLElement;
    return {
        host,
        store,
        panel,
        root,
        panelElement,
        q: <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T | null,
        qa: (selector) => [...root.querySelectorAll<HTMLElement>(selector)],
    };
};

const setViewport = (width: number): void => {
    Object.defineProperty(document.documentElement, "clientWidth", {value: width, configurable: true});
};

const fire = (element: HTMLElement, type: string): void => {
    element.dispatchEvent(new Event(type, {bubbles: true}));
};

/** jsdom 不排版，矩形必须自己造。 */
const rectOf = (left: number, top: number, width: number, height: number): DOMRect => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
});

/**
 * 给页签栏与其中的页签摆一份几何：jsdom 里 `clientWidth` / `scrollWidth` 恒为 0，
 * 不先摆好，「页签要不要滚」这件事根本无从判断。
 *
 * `start` 是页签在滚动容器里的起始位置，`view` 是滚动容器看得见的那一段长度。
 */
const stubScrollBox = (
    scroller: HTMLElement,
    item: HTMLElement,
    geometry: {view: number; content: number; start: number; size: number; vertical?: boolean;},
): void => {
    const vertical = Boolean(geometry.vertical);
    Object.defineProperty(scroller, vertical ? "clientHeight" : "clientWidth", {
        value: geometry.view,
        configurable: true,
    });
    Object.defineProperty(scroller, vertical ? "scrollHeight" : "scrollWidth", {
        value: geometry.content,
        configurable: true,
    });
    Object.defineProperty(scroller, vertical ? "scrollTop" : "scrollLeft", {
        value: 0,
        writable: true,
        configurable: true,
    });
    scroller.getBoundingClientRect = () => rectOf(0, 0, vertical ? 40 : geometry.view, vertical ? geometry.view : 40);
    item.getBoundingClientRect = () =>
        vertical ?
            rectOf(0, geometry.start, 40, geometry.size) :
            rectOf(geometry.start, 0, geometry.size, 40);
};

/** 让面板读「上次的页签」这一步卡住，好在恢复之前把几何摆好。返回放行函数。 */
const gatePanelState = (host: FakeHost): () => void => {
    const original = host.loadData.getMockImplementation() as (name: string) => Promise<unknown>;
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    host.loadData.mockImplementation(async (name: string): Promise<unknown> => {
        if (name === "feature-panel-state") {
            await blocked;
        }
        return original(name);
    });
    return release;
};

/** 等一帧：页签栏量不到宽度时面板会在下一帧补滚一次。 */
const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });

beforeEach(() => {
    setViewport(1200);
    window.siyuan.config.system.kernelVersion = "3.8.7";
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});

describe("show：渲染", () => {
    it("用宿主的 Setting 打开对话框，标题取插件显示名", async () => {
        const {panel, root} = await open();
        expect(panel.isOpen).toBe(true);
        expect(mockState.settings).toHaveLength(1);
        expect(root.querySelector(".b3-dialog__container")).not.toBeNull();
    });

    it("重复 show 不会开出第二个对话框", async () => {
        const {panel} = await open();
        panel.show();
        expect(mockState.settings).toHaveLength(1);
        expect(document.querySelectorAll(".b3-dialog")).toHaveLength(1);
    });

    it("每个有内容的分类一个页签，默认停在第一个", async () => {
        const {qa, q} = await open([
            featureOf("alpha", {category: "editor"}),
            featureOf("secondary", {category: "appearance"}),
        ]);
        const tabs = qa("[data-ss-tab]");
        expect(tabs.map((tab) => tab.dataset.ssTab)).toEqual(["editor", "appearance"]);
        expect(tabs[0].classList.contains("b3-list-item--focus")).toBe(true);
        expect(tabs[0].getAttribute("aria-selected")).toBe("true");
        expect(tabs[1].getAttribute("aria-selected")).toBeNull();

        const panes = qa("[data-ss-tab-panel]");
        expect(panes.map((pane) => pane.dataset.ssTabPanel)).toEqual(["editor", "appearance"]);
        expect(panes[1].classList.contains("fn__none")).toBe(true);
        // 页签文案走 i18n
        expect(q('[data-ss-tab="editor"] .b3-list-item__text')?.textContent).toBe("编辑");
        // 页签按 FEATURE_CATEGORIES 的顺序排列，缺内容的分类不出现
        expect(qa("[data-ss-tab]")).toHaveLength(2);
    });

    it("桌面端是左侧页签列表，不是移动端页签栏", async () => {
        const {panelElement, q} = await open();
        expect(panelElement.classList.contains(`${PANEL_CLASS}--mobile`)).toBe(false);
        expect(q(`.${PANEL_CLASS}__side`)).not.toBeNull();
        expect(q(".layout-tab-bar")).toBeNull();
    });

    it("移动端换成顶部页签栏", async () => {
        mockState.frontend = "mobile";
        const {panelElement, q} = await open();
        expect(panelElement.classList.contains(`${PANEL_CLASS}--mobile`)).toBe(true);
        expect(q(".layout-tab-bar")).not.toBeNull();
        expect(q(`.${PANEL_CLASS}__side`)).toBeNull();
    });

    it("功能行上带功能名、说明与开关，开关不再单独占一行", async () => {
        const {q, qa} = await open();
        const row = q('[data-ss-row="alpha::enabled"]');
        expect(row?.tagName).toBe("LABEL");
        expect(row?.textContent).toContain("甲功能");
        expect(row?.textContent).toContain("甲的说明");
        // 整页里只有一处 enabled 开关
        expect(qa('[data-ss-switch="alpha::enabled"]')).toHaveLength(1);
    });

    it("拿 selector 当开关的功能，把那个下拉提到功能行上", async () => {
        const {q} = await open([featureOf("switch-mode", {
            category: "settings",
            settings: [{
                kind: "select",
                key: "scope",
                title: "switch-mode.scope",
                default: "off",
                options: [{value: "off", label: "switch-mode.off"}, {value: "on", label: "switch-mode.on"}],
            }],
            isEnabled: (config) => config.scope === "on",
        })]);
        const row = q('[data-ss-row="switch-mode::scope"]');
        expect(row?.tagName).toBe("DIV");
        const select = row?.querySelector("select");
        expect(select?.dataset.ssSelect).toBe("switch-mode::scope");
        expect(select?.value).toBe("off");
    });

    it("每种字段都渲染成对应的控件", async () => {
        const {q} = await open();
        expect(q('[data-ss-number="alpha::size"]')?.getAttribute("value")).toBe("12");
        expect(q('[data-ss-number="alpha::size"]')?.closest(".config-item__number")?.textContent).toContain("px");
        const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]');
        expect(text?.value).toBe("hi");
        expect(text?.getAttribute("placeholder")).toBe("请输入标签");
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]');
        expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual(["自动", "手动"]);
        expect(q('[data-ss-button="alpha::run"]')?.textContent).toBe("点我执行");
    });

    it("多行文本渲染成整行的 textarea：行数、占位文案与说明都在", async () => {
        const {q} = await open([featureOf("area", {
            settings: [
                {kind: "switch", key: "enabled", title: "alpha.enabled", default: false},
                {
                    kind: "textarea",
                    key: "authors",
                    title: "area.authors",
                    description: "area.authors.desc",
                    placeholder: "area.authors.ph",
                    default: "acme\nfoo",
                    rows: 4,
                },
            ],
        })]);
        const area = q<HTMLTextAreaElement>('[data-ss-textarea="area::authors"]');
        expect(area?.value).toBe("acme\nfoo");
        expect(area?.getAttribute("rows")).toBe("4");
        expect(area?.getAttribute("placeholder")).toBe("作者占位");
        const row = area?.closest(".config-item");
        expect(row?.classList.contains(`${PANEL_CLASS}__textarea-row`)).toBe(true);
        expect(row?.textContent).toContain("一行一个作者");
    });

    it("每个功能的最后一个子行带上收尾标记，层级引导线在那里画成折角", async () => {
        const {qa} = await open([
            featureOf("alpha", {category: "editor"}),
            featureOf("secondary", {category: "editor"}),
        ]);
        const marked = qa(`.${PANEL_CLASS}__child--last`);
        // 两个功能各一个：末行是那个功能自己的最后一行，不是整页的最后一行
        expect(marked).toHaveLength(2);
        expect(marked.map((row) => row.dataset.ssRow)).toEqual(["alpha::run", "secondary::run"]);
    });

    it("说明块把占位符换成值，链接用短写显示", async () => {
        const {q} = await open();
        const note = q('[data-ss-row="alpha::about"]');
        expect(note?.textContent).toContain("版本 1.0.1");
        const anchor = note?.querySelector("a");
        expect(anchor?.textContent).toBe("owner/repo");
        expect(anchor?.getAttribute("href")).toBe("https://github.com/wmy2981/some-settings-siyuan");
    });

    it("没有任何功能时给出空状态", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: []});
        panel.show();
        const root = mockState.settings[0].dialog!.element;
        expect(root.querySelector(`.${PANEL_CLASS}__empty`)?.textContent).toBe("本宿主没有可用的设置项");
    });

    it("函数型按钮文案每次打开面板时求值", async () => {
        const label = vi.fn((context: FeatureActionContext) => `${context.i18n("alpha.run")}（运行期）`);
        const {q} = await open([featureOf("alpha", {
            settings: [{
                kind: "button",
                key: "run",
                title: "alpha.run",
                label,
                onClick: () => undefined,
            }],
        })]);
        expect(label).toHaveBeenCalledTimes(1);
        expect(q('[data-ss-button="alpha::run"]')?.textContent).toBe("执行（运行期）");
    });

    it("动作行的现成 SVG 图标（iconSvg）也能透传", async () => {
        const iconSvg = '<svg viewBox="0 0 32 32"><path fill="#01beff" d="M0 0h1v1H0z"/></svg>';
        const {q} = await open([featureOf("alpha", {
            settings: [{
                kind: "button",
                key: "run",
                title: "alpha.run",
                label: "alpha.runLabel",
                iconSvg,
                appearance: "block",
                onClick: () => undefined,
            }],
        })]);
        const button = q<HTMLButtonElement>('[data-ss-button="alpha::run"]')!;
        expect(button.querySelector("svg path")?.getAttribute("fill")).toBe("#01beff");
    });

    it("功能没写说明时功能行只有标题", async () => {
        const {q} = await open([featureOf("alpha", {description: undefined})]);
        const row = q('[data-ss-row="alpha::enabled"]');
        expect(row?.textContent).toContain("甲功能");
        expect(row?.querySelector(".b3-label__text")).toBeNull();
    });

    it("下拉既没有静态选项也没有动态来源时渲染成空下拉", async () => {
        const {q} = await open([featureOf("alpha", {
            settings: [{kind: "select", key: "mode", title: "alpha.mode", default: "a"}],
        })]);
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]');
        expect(select?.options).toHaveLength(0);
    });

    it("动态下拉的候选集每次打开面板时重新求值", async () => {
        let options = [{value: "a", label: "alpha.auto"}];
        const definitions = [featureOf("alpha", {
            settings: [{
                kind: "select",
                key: "mode",
                title: "alpha.mode",
                default: "a",
                optionsProvider: () => options,
            }],
        })];
        const {panel, q} = await open(definitions);
        expect(q<HTMLSelectElement>('[data-ss-select="alpha::mode"]')?.options).toHaveLength(1);

        panel.close();
        options = [{value: "a", label: "alpha.auto"}, {value: "b", label: "alpha.manual"}];
        panel.show();
        const root = mockState.settings[mockState.settings.length - 1].dialog!.element;
        expect(root.querySelectorAll('select[data-ss-select="alpha::mode"] option')).toHaveLength(2);
    });
});

describe("show：宿主结构差异", () => {
    it("正文区里缺 content 时自己补上，动作区则不需要", async () => {
        mockState.settingRegionsMissing = true;
        const {root} = await open();
        expect(root.querySelector(".b3-dialog__body > .b3-dialog__content")).not.toBeNull();
        // 面板没有保存 / 取消，宿主没建动作区时也不补
        expect(root.querySelector("[data-ss-save]")).toBeNull();
        expect(root.querySelector("[data-ss-cancel]")).toBeNull();
    });

    it("标题优先用插件显示名，没有时退回包名", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(featureOf("alpha"));
        new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]}).show();
        expect(mockState.settingTitles[0]).toBe("some settings");

        const anonymous = new FakeHost() as unknown as {displayName?: string; asPlugin: () => Plugin;};
        delete anonymous.displayName;
        const secondStore = new ConfigStore(anonymous.asPlugin());
        await secondStore.register(featureOf("alpha"));
        new SettingsPanel({plugin: anonymous.asPlugin(), store: secondStore, features: [featureOf("alpha")]}).show();
        expect(mockState.settingTitles[1]).toBe("some-settings-siyuan");
    });
});

describe("show：宿主异常", () => {
    it("Setting.open() 抛错时收干净状态并上报", async () => {
        mockState.settingOpenError = new Error("host refused");
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(featureOf("alpha"));
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]});

        panel.show();

        expect(panel.isOpen).toBe(false);
        expect(mockState.messages[0].text).toContain("host refused");
    });

    it("宿主没建出对话框时同样不留半成品", async () => {
        mockState.settingDialogMissing = true;
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]});

        panel.show();

        expect(panel.isOpen).toBe(false);
        expect(mockState.messages[0].text).toContain("the host did not create a settings dialog");
    });

    it("对话框没有正文区时关掉它并上报", async () => {
        mockState.settingBodyMissing = true;
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]});

        panel.show();

        expect(mockState.settings[0].closed).toBe(true);
        expect(mockState.messages[0].text).toContain("no body");
    });
});

describe("只读模式", () => {
    it("控件全部禁用，并提示只读", async () => {
        window.siyuan.config.readonly = true;
        const {q, qa} = await open();
        expect(mockState.messages[0].text).toBe("只读工作空间");
        expect(q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')?.disabled).toBe(true);
        expect(q<HTMLSelectElement>('[data-ss-select="alpha::mode"]')?.disabled).toBe(true);
        expect(q<HTMLInputElement>('[data-ss-number="alpha::size"]')?.disabled).toBe(true);
        expect(q<HTMLInputElement>('[data-ss-text="alpha::label"]')?.disabled).toBe(true);
        expect(q<HTMLButtonElement>('[data-ss-button="alpha::run"]')?.disabled).toBe(true);
        // 底栏没有保存 / 取消，动作区整块收起
        expect(qa("[data-ss-cancel]")).toHaveLength(0);
        expect(qa("[data-ss-save]")).toHaveLength(0);
        expect(q(".b3-dialog__action")?.classList.contains("fn__none")).toBe(true);
    });

    it("发布模式下同样按只读处理", async () => {
        window.siyuan.isPublish = true;
        const {q} = await open();
        expect(q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')?.disabled).toBe(true);
    });
});

describe("页签交互", () => {
    const twoTabs = (): FeatureDefinition[] => [
        featureOf("alpha", {category: "editor"}),
        featureOf("secondary", {category: "appearance"}),
    ];

    it("点击页签切换选中状态与可见页", async () => {
        const {q, qa} = await open(twoTabs());
        (qa("[data-ss-tab]")[1] as HTMLElement).click();

        expect(qa("[data-ss-tab]")[1].classList.contains("b3-list-item--focus")).toBe(true);
        expect(qa("[data-ss-tab]")[0].classList.contains("b3-list-item--focus")).toBe(false);
        expect(q('[data-ss-tab-panel="editor"]')?.classList.contains("fn__none")).toBe(true);
        expect(q('[data-ss-tab-panel="appearance"]')?.classList.contains("fn__none")).toBe(false);
    });

    it("回车与空格都能切换，其它键不动", async () => {
        const {qa} = await open(twoTabs());
        const second = qa("[data-ss-tab]")[1];
        second.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab"}));
        expect(second.getAttribute("aria-selected")).toBeNull();

        second.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));
        expect(second.getAttribute("aria-selected")).toBe("true");

        qa("[data-ss-tab]")[0].dispatchEvent(new KeyboardEvent("keydown", {key: " "}));
        expect(qa("[data-ss-tab]")[0].getAttribute("aria-selected")).toBe("true");
    });

    it("输入法组字期间不响应键盘切换", async () => {
        const {qa} = await open(twoTabs());
        const second = qa("[data-ss-tab]")[1];
        second.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true}));
        expect(second.getAttribute("aria-selected")).toBeNull();
    });

    it("关闭时保存当前页签，新面板直接恢复它", async () => {
        const first = await open(twoTabs());
        first.qa("[data-ss-tab]")[1].click();
        first.panel.close();
        await vi.waitFor(() => expect(first.host.files.get("feature-panel-state")).toEqual({tab: "appearance"}));

        const second = await open(twoTabs(), {}, first.host);
        await vi.waitFor(() =>
            expect(second.q('[data-ss-tab="appearance"]')?.getAttribute("aria-selected")).toBe("true")
        );
        expect(second.q('[data-ss-tab-panel="appearance"]')?.classList.contains("fn__none")).toBe(false);
        expect(second.q('[data-ss-tab-panel="editor"]')?.classList.contains("fn__none")).toBe(true);
    });

    it("记忆的页签已经不存在时退回首个页签", async () => {
        const {qa} = await open(twoTabs(), {"panel-state": {tab: "settings"}});
        await Promise.resolve();
        await Promise.resolve();
        expect(qa("[data-ss-tab]")[0].getAttribute("aria-selected")).toBe("true");
    });

    it("没有切换页签时关闭不重复写状态", async () => {
        const {host, panel} = await open(twoTabs(), {"panel-state": {tab: "editor"}});
        await vi.waitFor(() => expect(host.loadData).toHaveBeenCalledWith("feature-panel-state"));
        await Promise.resolve();
        panel.close();
        await Promise.resolve();
        expect(host.saveData).not.toHaveBeenCalledWith("feature-panel-state", expect.anything());
    });

    it("插件卸载关闭面板时也保存页签", async () => {
        const {host, panel, qa} = await open(twoTabs());
        qa("[data-ss-tab]")[1].click();
        panel.dispose();
        await vi.waitFor(() => expect(host.files.get("feature-panel-state")).toEqual({tab: "appearance"}));
    });

    it("页签状态写盘失败时给出可见错误", async () => {
        const {host, panel, qa} = await open(twoTabs());
        host.rejectWrites = true;
        qa("[data-ss-tab]")[1].click();
        panel.close();
        await vi.waitFor(() =>
            expect(mockState.messages.some((message) => message.text.includes("settings.panel-state"))).toBe(true)
        );
        expect(host.files.get("feature-panel-state")).toBeUndefined();
    });

    it("读取历史状态时用户已经手动切页，以用户的选择为准", async () => {
        let releaseRead: (() => void) | undefined;
        const blocked = new Promise<void>((resolve) => {
            releaseRead = resolve;
        });
        const {host, panel} = await open(twoTabs());
        host.loadData.mockImplementation(async (name: string): Promise<unknown> => {
            if (name === "feature-panel-state") {
                await blocked;
            }
            return host.files.get(name) ?? "";
        });
        host.files.set("feature-panel-state", {tab: "editor"});
        panel.close();
        panel.show();
        const root = mockState.settings[mockState.settings.length - 1].dialog!.element;
        const tabs = [...root.querySelectorAll<HTMLElement>("[data-ss-tab]")];
        tabs[1].click();
        releaseRead?.();
        await Promise.resolve();
        await Promise.resolve();
        expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    });

    it("旧面板的异步读取不会覆盖重新打开后的页签", async () => {
        let releaseRead: (() => void) | undefined;
        const blocked = new Promise<void>((resolve) => {
            releaseRead = resolve;
        });
        const first = await open(twoTabs());
        first.host.loadData.mockImplementation(async (name: string): Promise<unknown> => {
            if (name === "feature-panel-state") {
                await blocked;
            }
            return first.host.files.get(name) ?? "";
        });
        first.panel.close();
        first.panel.show();
        releaseRead?.();
        await Promise.resolve();
        await Promise.resolve();
        expect(first.qa("[data-ss-tab]")[0].getAttribute("aria-selected")).toBe("true");
    });

    it("恢复记住的页签时把移动端页签栏滚到它", async () => {
        mockState.frontend = "mobile";
        const host = new FakeHost();
        host.files.set("feature-panel-state", {tab: "appearance"});
        const release = gatePanelState(host);
        const {qa, q} = await open(twoTabs(), {}, host);
        const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
        // 页签栏一屏只放得下 300px，第二个页签在 520px 处：恢复之后必须滚过去。
        stubScrollBox(bar, qa("[data-ss-tab]")[1], {view: 300, content: 900, start: 520, size: 130});

        release();
        await vi.waitFor(() => expect(qa("[data-ss-tab]")[1].getAttribute("aria-selected")).toBe("true"));

        expect(bar.scrollLeft).toBe(350);
    });

    it("页签已经完整可见时不滚页签栏", async () => {
        mockState.frontend = "mobile";
        const {qa, q} = await open(twoTabs());
        const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
        stubScrollBox(bar, qa("[data-ss-tab]")[1], {view: 300, content: 900, start: 80, size: 130});

        qa("[data-ss-tab]")[1].click();

        expect(bar.scrollLeft).toBe(0);
    });

    it("页签栏整条放得下时不做任何滚动", async () => {
        mockState.frontend = "mobile";
        const {qa, q} = await open(twoTabs());
        const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
        stubScrollBox(bar, qa("[data-ss-tab]")[1], {view: 600, content: 600, start: 300, size: 130});

        qa("[data-ss-tab]")[1].click();

        expect(bar.scrollLeft).toBe(0);
    });

    it("页签栏还没量到宽度时下一帧补滚", async () => {
        mockState.frontend = "mobile";
        const {qa, q} = await open(twoTabs());
        const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
        const target = qa("[data-ss-tab]")[1];
        // 抽屉刚挂上：宽度还是 0，这一帧量不出要不要滚。
        stubScrollBox(bar, target, {view: 0, content: 900, start: 520, size: 130});
        target.click();
        expect(bar.scrollLeft).toBe(0);

        stubScrollBox(bar, target, {view: 300, content: 900, start: 520, size: 130});
        await nextFrame();

        expect(bar.scrollLeft).toBe(350);
    });

    it("桌面端左侧页签列表同样把选中的页签滚出来", async () => {
        const {qa, q} = await open(twoTabs());
        const list = q<HTMLElement>(`.${PANEL_CLASS}__tabs`) as HTMLElement;
        stubScrollBox(list, qa("[data-ss-tab]")[1], {
            view: 100,
            content: 260,
            start: 150,
            size: 48,
            vertical: true,
        });

        qa("[data-ss-tab]")[1].click();

        expect(list.scrollTop).toBe(98);
    });
});

describe("改完即写", () => {
    it("底栏没有任何保存 / 取消按钮，动作区整块收起", async () => {
        const {q, qa} = await open();
        expect(qa("[data-ss-save]")).toHaveLength(0);
        expect(qa("[data-ss-cancel]")).toHaveLength(0);
        expect(q(".b3-dialog__action")?.classList.contains("fn__none")).toBe(true);
        expect(q(".b3-dialog__action")?.children).toHaveLength(0);
    });

    it("开关改动立即落盘，不需要点任何按钮", async () => {
        const {q, host} = await open();
        const toggle = q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')!;
        toggle.checked = true;
        fire(toggle, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({enabled: true}));
        expect(mockState.settings[0].closed).toBe(false);
    });

    it("下拉改动立即落盘", async () => {
        const {q, host} = await open();
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]')!;
        select.value = "manual";
        fire(select, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({mode: "manual"}));
    });

    it("数字框在失焦（change）时立即落盘，并按 min / max 夹住", async () => {
        const {q, host} = await open();
        const number = q<HTMLInputElement>('[data-ss-number="alpha::size"]')!;
        number.value = "40";
        fire(number, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({size: 24}));
        expect(number.value).toBe("24");
    });

    it("清空数字框时按 0 处理，落盘前被 min 夹住", async () => {
        // type=number 的输入框拿不到真正的非数字值（非法输入会被浏览器清成空串），
        // 所以这里覆盖的是「清空」这条真实路径：空串 -> 0 -> 夹到 min
        const {q, host} = await open();
        const number = q<HTMLInputElement>('[data-ss-number="alpha::size"]')!;
        number.value = "";
        fire(number, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({size: 8}));
        expect(number.value).toBe("8");
    });

    it("文本输入按静默期合并写盘，连打几个字只写一次", async () => {
        const {q, host} = await open();
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        for (const value of ["改", "改过", "改过的"]) {
            input.value = value;
            fire(input, "input");
        }
        // 静默期没到之前不写
        expect(host.saveData).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "改过的"}));
        expect(host.saveData).toHaveBeenCalledTimes(1);
    });

    it("多行文本与单行文本同一套静默期：打字合并写、失焦立即写", async () => {
        const {q, host} = await open([featureOf("area", {
            settings: [
                {kind: "switch", key: "enabled", title: "alpha.enabled", default: false},
                {kind: "textarea", key: "authors", title: "area.authors", default: ""},
            ],
        })]);
        const area = q<HTMLTextAreaElement>('[data-ss-textarea="area::authors"]')!;
        area.value = "acme\nfoo";
        fire(area, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        fire(area, "change");
        await vi.waitFor(() => expect(host.files.get("feature-area")).toMatchObject({authors: "acme\nfoo"}));
    });

    it("连续输入从最后一次输入重新计时", async () => {
        vi.useFakeTimers();
        try {
            const {q, host} = await open();
            const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;

            input.value = "一";
            fire(input, "input");
            await vi.advanceTimersByTimeAsync(300);
            input.value = "一二";
            fire(input, "input");
            await vi.advanceTimersByTimeAsync(300);
            // 距第一次输入 600ms，但距最后一次只有 300ms：静默期要从最后一次算起
            expect(host.saveData).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(150);
            expect(host.saveData).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("一个功能的立即提交不会吞掉另一个功能的静默期写盘", async () => {
        const {q, host} = await open([featureOf("alpha"), featureOf("beta")]);
        const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        text.value = "待写";
        fire(text, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        // 开关是一次立即提交：它清掉的计时器是共用那一个，必须给还在静默期的 alpha 重新排上
        const toggle = q<HTMLInputElement>('[data-ss-switch="beta::enabled"]')!;
        toggle.checked = true;
        fire(toggle, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "待写"}));
    });

    it("静默期还没到就失焦时，改动立刻写盘且只写一次", async () => {
        const {q, host} = await open();
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "马上";
        fire(input, "input");
        fire(input, "change");

        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));
        expect(host.files.get("feature-alpha")).toMatchObject({label: "马上"});
    });

    it("写入过程中继续输入，后续静默写盘不能带上旧值", async () => {
        const {q, host} = await open();
        let releaseFirstWrite: (() => void) | undefined;
        const firstWrite = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        host.saveData.mockImplementationOnce(async (name: string, value: unknown): Promise<unknown> => {
            await firstWrite;
            host.files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "第一次";
        fire(input, "input");
        fire(input, "change");
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));
        input.value = "第二次";
        fire(input, "input");
        releaseFirstWrite?.();
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(2));
        expect(host.saveData.mock.calls[1]?.[1]).toMatchObject({label: "第二次"});
        expect(host.files.get("feature-alpha")).toMatchObject({label: "第二次"});
        expect(input.value).toBe("第二次");
    });

    it("关面板时把还没落地的那一次补上", async () => {
        const {q, host, panel} = await open();
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "关窗前的字";
        fire(input, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        panel.close();

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "关窗前的字"}));
    });

    it("重选同一项不写盘", async () => {
        const {q, host} = await open(
            [featureOf("alpha")],
            {alpha: {enabled: false, size: 12, label: "hi", mode: "auto"}},
        );
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]')!;
        select.value = "auto";
        fire(select, "change");
        await Promise.resolve();

        expect(host.saveData).not.toHaveBeenCalled();
    });

    it("写盘失败时控件回到磁盘上的值，并把问题显示出来", async () => {
        const {q, host} = await open();
        host.rejectWrites = true;
        const toggle = q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')!;
        toggle.checked = true;
        fire(toggle, "change");

        const reported = (): boolean => mockState.messages.some((message) => message.text.includes("code 1: readonly"));
        await vi.waitFor(() => expect(reported()).toBe(true));
        expect(toggle.checked).toBe(false);
        expect(host.files.get("feature-alpha")).toBeUndefined();
        expect(mockState.settings[0].closed).toBe(false);
    });

    it("重新打开时显示的就是磁盘上的值", async () => {
        const {panel} = await open([featureOf("alpha")], {alpha: {enabled: true, label: "已存"}});
        panel.close();
        panel.show();
        const root = mockState.settings[mockState.settings.length - 1].dialog!.element;
        expect(root.querySelector<HTMLInputElement>('[data-ss-text="alpha::label"]')?.value).toBe("已存");
    });
});

describe("动作行", () => {
    it("点击立刻执行，拿到功能 id、插件名与配置快照", async () => {
        const onClick = vi.fn();
        const {q} = await open([featureOf("alpha", {settings: alphaSettings(onClick)})]);
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();

        await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
        const context = onClick.mock.calls[0][0] as FeatureActionContext;
        expect(context.featureId).toBe("alpha");
        expect(context.pluginName).toBe("some-settings-siyuan");
        expect(context.i18n("alpha.run")).toBe("执行");
        expect(context.i18n("missing.key")).toBe("missing.key");
        const snapshot = context.configOf("alpha");
        expect(snapshot).toMatchObject({enabled: false, label: "hi"});
        // 快照是副本，改了不落盘
        snapshot.label = "本地改动";
        expect(context.configOf("alpha").label).toBe("hi");
    });

    it("updateConfig 立刻落盘，并同步面板上的开关", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })]);
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());

        await context!.updateConfig("alpha", {enabled: true});

        expect(host.files.get("feature-alpha")).toMatchObject({enabled: true});
        expect(q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')?.checked).toBe(true);
    });

    it("清除 / 导出 / 导入都转给配置存储", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());

        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: [{name: "feature-alpha", isDir: false}]});
        await expect(context!.exportConfigs()).resolves.toEqual({alpha: {enabled: true, label: "x"}});
        await expect(context!.clearAllConfigs()).resolves.toBeUndefined();
        expect(host.files.size).toBe(0);
        await expect(context!.importConfigs({alpha: {enabled: true, label: "回来的"}})).resolves.toEqual({
            applied: ["alpha"],
            skipped: [],
        });
        expect(host.files.get("feature-alpha")).toMatchObject({label: "回来的"});
    });

    it("动作行注册的清理回调在插件卸载时执行，关面板时不执行", async () => {
        let context: FeatureActionContext | undefined;
        const onUnload = vi.fn();
        const {q, panel} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
                actionContext.onUnload(onUnload);
            }),
        })]);
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());
        expect(onUnload).not.toHaveBeenCalled();

        panel.close();
        expect(onUnload).not.toHaveBeenCalled();

        panel.dispose();
        expect(onUnload).toHaveBeenCalledTimes(1);
    });

    it("onUnload 返回的函数可以单独注销这次清理", async () => {
        let context: FeatureActionContext | undefined;
        const onUnload = vi.fn();
        const {q, panel} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })]);
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());

        const off = context!.onUnload(onUnload);
        off();
        panel.dispose();
        expect(onUnload).not.toHaveBeenCalled();
    });

    it("执行期间按钮保持禁用，连点只跑一次", async () => {
        let done: () => void = () => undefined;
        const onClick = vi.fn(() =>
            new Promise<void>((resolve) => {
                done = resolve;
            })
        );
        const {q} = await open([featureOf("alpha", {settings: alphaSettings(onClick)})]);
        const button = q<HTMLButtonElement>('[data-ss-button="alpha::run"]')!;

        button.click();
        button.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(button.disabled).toBe(true);

        done();
        await vi.waitFor(() => expect(button.disabled).toBe(false));
    });

    it("动作行抛错时被隔离上报，按钮恢复可用", async () => {
        const onClick = vi.fn(() => {
            throw new Error("action failed");
        });
        const {q} = await open([featureOf("alpha", {settings: alphaSettings(onClick)})]);
        const button = q<HTMLButtonElement>('[data-ss-button="alpha::run"]')!;

        button.click();

        await vi.waitFor(() => expect(mockState.messages.some((m) => m.text.includes("action failed"))).toBe(true));
        expect(button.disabled).toBe(false);
    });

    it("找不到对应 onClick 的动作行只告警，不抛错", async () => {
        const definitions = [featureOf("alpha", {
            settings: [{
                kind: "button",
                key: "run",
                title: "alpha.run",
                label: "alpha.runLabel",
                onClick: () => undefined,
            }],
        })];
        const {q, panel} = await open(definitions);
        const button = q<HTMLButtonElement>('[data-ss-button="alpha::run"]')!;
        // 模拟「面板渲染完之后声明没了」：动作行找不到对应 onClick 时只能告警
        (panel as unknown as {options: {features: FeatureDefinition[];};}).options.features = [];
        expect(() => button.click()).not.toThrow();
        await vi.waitFor(() => expect(vi.mocked(console.warn)).toHaveBeenCalled());
    });
});

describe("说明块底部的按钮", () => {
    const withActions = (onClick = vi.fn()): FeatureDefinition[] => [
        featureOf("alpha", {
            settings: [
                {
                    kind: "note",
                    key: "about",
                    text: "alpha.about",
                    values: {version: "1.0.1", repo: "https://github.com/wmy2981/some-settings-siyuan"},
                    actions: [
                        {key: "star", label: "alpha.runLabel", appearance: "block", icon: "iconGithub", onClick},
                    ],
                },
            ],
        }),
    ];

    it("点一下就跑 onClick，并按「功能 id + key」拿到上下文", async () => {
        const onClick = vi.fn();
        const opened = await open(withActions(onClick));
        const button = opened.q<HTMLButtonElement>(".some-settings-panel__note-actions button")!;
        expect(button.dataset.ssButton).toBe("alpha::star");
        button.click();
        await Promise.resolve();
        expect(onClick).toHaveBeenCalledWith(expect.objectContaining({featureId: "alpha"}));
    });

    it("现成 SVG 图标（iconSvg）原样进到按钮里", async () => {
        const iconSvg = '<svg viewBox="0 0 32 32"><path fill="#f15bb5" d="M0 0h1v1H0z"/></svg>';
        const opened = await open([
            featureOf("alpha", {
                settings: [
                    {
                        kind: "note",
                        key: "about",
                        text: "alpha.about",
                        actions: [
                            {key: "donate", label: "alpha.runLabel", appearance: "block", iconSvg, onClick: vi.fn()},
                        ],
                    },
                ],
            }),
        ]);
        const button = opened.q<HTMLButtonElement>(".some-settings-panel__note-actions button")!;
        // 不加工：原样内联，交给内核的 .b3-button svg 规则缩到 16px
        expect(button.querySelector("svg path")?.getAttribute("fill")).toBe("#f15bb5");
        expect(button.querySelector("use")).toBeNull();
    });

    it("只读模式下按钮禁用", async () => {
        window.siyuan.config.readonly = true;
        const onClick = vi.fn();
        const opened = await open(withActions(onClick));
        const button = opened.q<HTMLButtonElement>(".some-settings-panel__note-actions button")!;
        expect(button.disabled).toBe(true);
    });
});

describe("说明块外链", () => {
    it("先让插件有机会拦下，没人拦时才 window.open", async () => {
        const {q} = await open();
        const anchor = q<HTMLAnchorElement>('[data-ss-row="alpha::about"] a')!;
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        anchor.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(window.open).toHaveBeenCalledWith(anchor.href, "_blank");
    });

    it("遇到没有事件总线的插件对象时跳过它，仍然打开链接", async () => {
        window.siyuan.ws.app.plugins = [{} as never];
        const {q} = await open();
        const anchor = q<HTMLAnchorElement>('[data-ss-row="alpha::about"] a')!;
        anchor.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(window.open).toHaveBeenCalledWith(anchor.href, "_blank");
    });

    it("任一插件 emit 返回 false 时不再打开", async () => {
        const emit = vi.fn(() => false);
        window.siyuan.ws.app.plugins = [{eventBus: {emit}} as never];
        const {q} = await open();
        const anchor = q<HTMLAnchorElement>('[data-ss-row="alpha::about"] a')!;
        anchor.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));

        expect(emit).toHaveBeenCalledWith("open-link", expect.objectContaining({href: anchor.href}));
        expect(window.open).not.toHaveBeenCalled();
    });
});

describe("异常路径", () => {
    it("控件对应的功能不存在时只告警，改动被丢弃", async () => {
        const {q, panel} = await open();
        (panel as unknown as {options: {features: FeatureDefinition[];};}).options.features = [];
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "丢弃";
        expect(() => fire(input, "change")).not.toThrow();
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining("has no matching feature"));
    });

    it("写盘抛出不带问题清单的异常时也照常上报", async () => {
        const {q, store} = await open();
        store.patch = vi.fn(async () => {
            throw new Error("unexpected failure");
        });
        const toggle = q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')!;
        toggle.checked = true;
        fire(toggle, "change");

        await vi.waitFor(() =>
            expect(mockState.messages.some((m) => m.text.includes("unexpected failure"))).toBe(true)
        );
        expect(mockState.settings[0].closed).toBe(false);
    });

    it("声明里出现未知控件类型时跳过它，面板其余部分正常", async () => {
        const definitions = [featureOf("alpha", {
            settings: [
                {kind: "switch", key: "enabled", title: "alpha.enabled", default: false},
                {kind: "mystery", key: "future", title: "alpha.future"} as unknown as SettingField,
                {kind: "text", key: "label", title: "alpha.label", default: "hi"},
            ],
        })];
        const {q} = await open(definitions);
        expect(q('[data-ss-row="alpha::future"]')).toBeNull();
        expect(q('[data-ss-text="alpha::label"]')).not.toBeNull();
    });
});

describe("布局与宽度", () => {
    it("桌面端按视口算宽度，并挂上量到的事实", async () => {
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("900px");
        expect(container.dataset.ssViewport).toBe("1200");
        expect(container.dataset.ssWidth).toBe("900");
        expect(container.dataset.ssNarrow).toBe("false");
    });

    it("窄屏按视口留边，且上限仍生效", async () => {
        setViewport(700);
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("676px");
        expect(container.dataset.ssNarrow).toBe("true");
    });

    it("极窄视口下不低于最小可用宽度", async () => {
        setViewport(300);
        const {root} = await open();
        expect(root.querySelector<HTMLElement>(".b3-dialog__container")?.style.width).toBe("280px");
    });

    it("内容区不滚动、内边距归零，滚动交给每一页", async () => {
        const {root} = await open();
        const content = root.querySelector<HTMLElement>(".b3-dialog__content")!;
        expect(content.style.padding).toBe("0px");
        expect(content.style.overflow).toBe("hidden");
    });

    it("独立设置窗口里不写宽度，交给宿主铺满", async () => {
        mockState.settingAsWindow = true;
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("");
        expect(container.dataset.ssWidth).toBeUndefined();
    });

    it("移动端不写宽度，交给宿主的底部抽屉", async () => {
        mockState.frontend = "mobile";
        setViewport(420);
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("");
        expect(root.querySelector<HTMLElement>(".b3-dialog__content")?.style.overflow).toBe("auto");
    });

    it("documentElement 量不到宽度时退回 window.innerWidth", async () => {
        setViewport(0);
        window.innerWidth = 800;
        const {root} = await open();
        expect(root.querySelector<HTMLElement>(".b3-dialog__container")?.style.width).toBe("752px");
    });

    it("视口变化后重新计算宽度", async () => {
        vi.useFakeTimers();
        try {
            const {root} = await open();
            const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
            expect(container.style.width).toBe("900px");

            setViewport(500);
            vi.advanceTimersByTime(300);
            expect(container.style.width).toBe("476px");
            expect(container.dataset.ssNarrow).toBe("true");
        } finally {
            vi.useRealTimers();
        }
    });

    it("对话框被宿主从页面移除后停止监听视口", async () => {
        vi.useFakeTimers();
        try {
            const {root} = await open();
            const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
            root.remove();
            setViewport(500);
            vi.advanceTimersByTime(300);

            expect(container.style.width).toBe("900px");
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("关闭后停止监听视口", async () => {
        vi.useFakeTimers();
        try {
            const {root, panel} = await open();
            const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
            panel.close();
            setViewport(500);
            vi.advanceTimersByTime(1000);
            expect(container.style.width).toBe("900px");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("关闭与卸载", () => {
    it("close 之后 isOpen 为假，可以再次打开", async () => {
        const {panel} = await open();
        panel.close();
        expect(panel.isOpen).toBe(false);
        panel.show();
        expect(panel.isOpen).toBe(true);
        expect(mockState.settings).toHaveLength(2);
    });

    it("dispose 收掉面板，且重复调用安全", async () => {
        const {panel} = await open();
        panel.dispose();
        expect(panel.isOpen).toBe(false);
        expect(() => panel.dispose()).not.toThrow();
    });

    it("清理回调里的异常不会冒泡出 dispose", async () => {
        let context: FeatureActionContext | undefined;
        const {q, panel} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
                actionContext.onUnload(() => {
                    throw new Error("cleanup failed");
                });
            }),
        })]);
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());

        expect(() => panel.dispose()).not.toThrow();
        expect(vi.mocked(console.error)).toHaveBeenCalled();
    });
});

/**
 * 全局搜索（issue #119）。
 *
 * 搜索只是面板的过滤机制：不新增功能、不加开关、不读写配置。这里按三块验证：
 * - 索引与匹配：能搜到什么、关键词怎么算命中；
 * - 显隐与恢复：命中后隐藏分类导航、聚合结果，清空后原样退回；
 * - 期间的状态：控件照常可用、待写文本不丢、高亮与快捷键。
 */
describe("搜索", () => {
    const HIT = `mark.${PANEL_CLASS}__hit`;
    const SEARCH = `.${PANEL_CLASS}--search`;

    const searchBox = (root: HTMLElement): HTMLInputElement => {
        const input = root.querySelector<HTMLInputElement>("[data-ss-search]");
        if (!input) {
            throw new Error("the panel has no search box");
        }
        return input;
    };

    /** 像用户打字那样改搜索框的值并触发 input。 */
    const typeQuery = (input: HTMLInputElement, value: string): void => {
        input.value = value;
        fire(input, "input");
    };

    const hidden = (element: Element | null | undefined): boolean => Boolean(element?.classList.contains("fn__none"));

    /** 在 document 上按一次键；面板的快捷键挂在捕获阶段。 */
    const press = (init: KeyboardEventInit & {isComposing?: boolean;}): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
        if (init.isComposing) {
            Object.defineProperty(event, "isComposing", {value: true});
        }
        document.dispatchEvent(event);
        return event;
    };

    /** 同一页里放两个功能：命中一个，另一个应当整体收起。 */
    const twoInEditor = (): FeatureDefinition[] => [
        featureOf("alpha", {category: "editor"}),
        featureOf("secondary", {category: "editor"}),
    ];

    describe("位置与初始状态", () => {
        it("桌面端搜索框在内容区顶部、设置行上方，不在左侧栏里", async () => {
            const {q} = await open(twoInEditor());
            const views = q(`.${PANEL_CLASS}__views`);
            const box = views?.querySelector(`.${PANEL_CLASS}__search`);
            expect(box).not.toBeNull();
            // 内容区的第一块是搜索框，第二块才是页签容器
            expect(views?.children[0]).toBe(box);
            expect(views?.children[1]?.className).toContain(`${PANEL_CLASS}__panes`);
            // 左侧栏只剩分类列表
            expect(q(`.${PANEL_CLASS}__side`)?.querySelector("[data-ss-search]")).toBeNull();
            expect(box?.querySelector("[data-ss-search]")).not.toBeNull();
        });

        it("移动端搜索框在面板标题下方、页签栏上方", async () => {
            mockState.frontend = "mobile";
            const {panelElement} = await open(twoInEditor());
            expect(panelElement.children[0]?.className).toContain(`${PANEL_CLASS}__search`);
            expect(panelElement.children[1]?.className).toContain("layout-tab-bar");
        });

        it("打开面板不自动聚焦搜索框（移动端因此不会弹键盘）", async () => {
            mockState.frontend = "mobile";
            const {root} = await open(twoInEditor());
            expect(document.activeElement).not.toBe(searchBox(root));
        });

        it("搜索框占位文案走 i18n", async () => {
            const {root} = await open(twoInEditor());
            expect(searchBox(root).getAttribute("placeholder")).toBe("搜索...");
        });

        it("一键清空按钮平时收起，输入内容后才出现", async () => {
            const {root, q} = await open(twoInEditor());
            const clear = q("[data-ss-search-clear]") as HTMLButtonElement;
            expect(hidden(clear)).toBe(true);

            typeQuery(searchBox(root), "甲");
            expect(hidden(clear)).toBe(false);

            typeQuery(searchBox(root), "");
            expect(hidden(clear)).toBe(true);
        });

        it("点一键清空就回到分类视图，焦点留在搜索框", async () => {
            const {root, q, panel} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲功能");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);

            (q("[data-ss-search-clear]") as HTMLButtonElement).click();

            expect(input.value).toBe("");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(false);
            expect(document.activeElement).toBe(input);
            expect(panel.isOpen).toBe(true);
        });

        it("Esc 清空后清空按钮同样收起", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            const clear = q("[data-ss-search-clear]") as HTMLButtonElement;
            typeQuery(input, "甲");
            expect(hidden(clear)).toBe(false);

            press({key: "Escape"});
            expect(input.value).toBe("");
            expect(hidden(clear)).toBe(true);
        });
    });

    describe("索引与匹配", () => {
        it("内部 id 与字段 key 始终可搜，且忽略大小写", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "ALPHA");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);

            typeQuery(input, "SIZE");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
        });

        it("关键词必须落在同一个字段上：跨字段拼不成一次命中", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            const empty = q(`.${PANEL_CLASS}__search-empty`);

            // 「功能」只在功能名里，「说明」只在功能说明里：一个字段都凑不齐
            typeQuery(input, "功能 说明");
            expect(hidden(empty)).toBe(false);
            // 同一个字段里都有 → 命中（说明是「甲的说明」）
            typeQuery(input, "甲 说明");
            expect(hidden(empty)).toBe(true);
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
        });

        it("多行文本的占位文案也进搜索索引", async () => {
            const {root, q} = await open([featureOf("area", {
                settings: [
                    {kind: "switch", key: "enabled", title: "alpha.enabled", default: false},
                    {
                        kind: "textarea",
                        key: "authors",
                        title: "area.authors",
                        placeholder: "area.authors.ph",
                        default: "",
                    },
                ],
            })]);
            typeQuery(searchBox(root), "作者占位");
            expect(hidden(q('[data-ss-feature="area"]'))).toBe(false);
        });

        it("静态文案的中英文版本算一个匹配域：命中另一语言时不高亮", async () => {
            const {root, q, qa} = await open([featureOf("alpha", {
                settings: [
                    {kind: "switch", key: "enabled", title: "alpha.enabled", default: false},
                    {kind: "switch", key: "extra", title: "common.enabled", default: false},
                ],
            })]);
            const input = searchBox(root);

            // 界面上显示的是中文「启用」，搜英文 enable 也要命中
            typeQuery(input, "enable");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
            // 命中的是另一份语言版本：不显示额外来源，也不强行把英文文案拉出来
            expect(qa(HIT)).toHaveLength(0);
            expect(q('[data-ss-feature="alpha"]')?.textContent).not.toContain("Enable");
        });

        it("分类名命中时显示该分类的全部功能", async () => {
            const {root, q} = await open([
                featureOf("alpha", {category: "editor"}),
                featureOf("secondary", {category: "appearance"}),
            ]);
            const input = searchBox(root);

            typeQuery(input, "编辑");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);
            expect(hidden(q('[data-ss-tab-panel="appearance"]'))).toBe(true);
            expect(hidden(q('[data-ss-search-group="editor"]'))).toBe(false);
            // 分类名命中也要能聚合成结果视图：导航收起、面板挂上搜索类
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(SEARCH.replace(".", ""))).toBe(true);
        });

        it("命中功能时显示它的全部可见设置项，包括没直接命中的字段", async () => {
            const {root, q, qa} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "甲的说明");
            const rows = qa('[data-ss-feature="alpha"]');
            // 开关行 + 数字 + 文本 + 下拉 + 说明块 + 动作行
            expect(rows).toHaveLength(6);
            expect(rows.every((row) => !hidden(row))).toBe(true);
            expect(q('[data-ss-feature="secondary"]')?.classList.contains("fn__none")).toBe(true);
        });

        it("分类与功能按现有声明顺序排，不做相关度排序", async () => {
            // 声明顺序是「外观」在前，但结果分组按 FEATURE_CATEGORIES 的顺序（编辑器在前）
            const {root, qa} = await open([
                featureOf("secondary", {category: "appearance"}),
                featureOf("alpha", {category: "editor"}),
            ]);
            typeQuery(searchBox(root), "功能");
            const groups = qa("[data-ss-search-group]")
                .filter((group) => !hidden(group))
                .map((group) => group.dataset.ssSearchGroup);
            expect(groups).toEqual(["editor", "appearance"]);
        });

        it("无结果时只显示「无结果」，不展示空分类也没有清除按钮", async () => {
            const {root, q, qa} = await open(twoInEditor());
            typeQuery(searchBox(root), "没有这个设置");

            expect(qa("[data-ss-tab-panel]").every((pane) => hidden(pane))).toBe(true);
            const empty = q(`.${PANEL_CLASS}__search-empty`);
            expect(hidden(empty)).toBe(false);
            expect(empty?.textContent).toBe("无结果");
            expect(qa(HIT)).toHaveLength(0);
        });
    });

    describe("显隐与恢复", () => {
        it("有查询时收起分类导航，但保留搜索框", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲");

            // 桌面端整根左侧栏（分类列表）收起，搜索框在内容区里，照旧可用。
            // 收起交给 `--search` 那段 CSS 的宽度过渡：这里刻意不加 fn__none，
            // display:none 会让收起 / 展开变成硬跳
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(q(`.${PANEL_CLASS}__side`))).toBe(false);
            expect(hidden(input.closest(`.${PANEL_CLASS}__search`))).toBe(false);
            expect(hidden(q(`.${PANEL_CLASS}__views`))).toBe(false);
        });

        it("移动端有查询时收起的是顶部页签栏，靠过渡而不是 display:none", async () => {
            mockState.frontend = "mobile";
            const {root, q, panelElement} = await open(twoInEditor());
            typeQuery(searchBox(root), "甲");
            expect(panelElement.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            // 收起交给 `--search` 那段 height 过渡：塞 fn__none 就没有过渡，一开一收是硬跳
            expect(hidden(q(".layout-tab-bar"))).toBe(false);
        });

        it("移动端收起前把页签栏的实测高度交给 CSS，展开结束后再交还给内容", async () => {
            mockState.frontend = "mobile";
            const {root, q} = await open(twoInEditor());
            const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
            // jsdom 量不出高度，这里给一个「内容撑出来的高度」
            const measured = vi.spyOn(bar, "offsetHeight", "get").mockReturnValue(42);
            const input = searchBox(root);

            typeQuery(input, "甲");
            expect(bar.style.getPropertyValue("--ss-tabbar-height")).toBe("42px");

            typeQuery(input, "");
            // 展开要从 0 长回 42px，起点这时候还不能删
            expect(bar.style.getPropertyValue("--ss-tabbar-height")).toBe("42px");
            // 过渡结束（200ms）之后删掉，高度回到 auto：方向变了、页签折行了也不会被死数卡住
            await vi.waitFor(() => expect(bar.style.getPropertyValue("--ss-tabbar-height")).toBe(""), {
                timeout: 1000,
            });
            measured.mockRestore();
        });

        it("过渡途中再次搜索不会把动画中间的高度当成起点", async () => {
            mockState.frontend = "mobile";
            const {root, q} = await open(twoInEditor());
            const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
            const measured = vi.spyOn(bar, "offsetHeight", "get").mockReturnValue(42);
            const input = searchBox(root);

            typeQuery(input, "甲");
            // 展开途中高度还在动画里（量到 0），这时候再搜一次不能拿 0 覆盖掉起点
            typeQuery(input, "");
            measured.mockReturnValue(0);
            typeQuery(input, "甲");

            expect(bar.style.getPropertyValue("--ss-tabbar-height")).toBe("42px");
            measured.mockRestore();
        });

        it("清空后恢复分类、页签、行与最后一行标记", async () => {
            const {root, q, qa} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "甲的说明");
            typeQuery(input, "");

            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
            expect(hidden(q(`.${PANEL_CLASS}__side`))).toBe(false);
            expect(qa(".config-item").every((row) => !hidden(row))).toBe(true);
            expect(hidden(q('[data-ss-search-group="editor"]'))).toBe(true);
            expect(hidden(q(`.${PANEL_CLASS}__search-empty`))).toBe(true);
            // 最后一行标记回到整页最后一行（第二个功能的动作行）
            const last = qa(".config-item--last-visible");
            expect(last).toHaveLength(1);
            expect(last[0].dataset.ssFeature).toBe("secondary");
        });

        it("反复切换查询后，每页仍然只有一个最后一行标记", async () => {
            const {root, qa} = await open(twoInEditor());
            const input = searchBox(root);

            for (const query of ["甲功能", "乙功能", "甲功能"]) {
                typeQuery(input, query);
                const marked = qa(".config-item--last-visible");
                expect(marked).toHaveLength(1);
                const visible = qa(".config-item").filter((row) => !hidden(row));
                expect(marked[0]).toBe(visible[visible.length - 1]);
            }
        });

        it("清空搜索后不留下相邻的文本节点", async () => {
            const {root, qa} = await open(twoInEditor());
            const input = searchBox(root);
            // 只命中标题的第一个字：高亮会把「甲功能」切成 mark + 文本两段，
            // 收尾时如果不合并相邻文本节点，这里就会留下两个并排的 Text
            typeQuery(input, "甲");
            typeQuery(input, "");

            const hasAdjacentText = (element: Element): boolean => {
                let previousWasText = false;
                for (const node of [...element.childNodes]) {
                    const isText = node.nodeType === 3;
                    if (isText && previousWasText) {
                        return true;
                    }
                    previousWasText = isText;
                }
                return false;
            };
            expect(qa(".config-item__main").some(hasAdjacentText)).toBe(false);
        });

        it("过滤后子行的收尾标记仍落在每个可见功能的最后一个子行上", async () => {
            const {root, qa} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "甲功能");
            const duringSearch = qa(`.${PANEL_CLASS}__child--last`);
            expect(duringSearch).toHaveLength(1);
            expect(duringSearch[0].dataset.ssRow).toBe("alpha::run");

            typeQuery(input, "");
            expect(qa(`.${PANEL_CLASS}__child--last`).map((row) => row.dataset.ssRow))
                .toEqual(["alpha::run", "secondary::run"]);
        });

        it("清空后回到搜索前的滚动位置", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            const pane = q('[data-ss-tab-panel="editor"]') as HTMLElement;
            const content = q(".b3-dialog__content") as HTMLElement;
            pane.scrollTop = 40;
            content.scrollTop = 7;

            typeQuery(input, "甲");
            // 搜索期间视图换成了结果列，滚动位置另算
            typeQuery(input, "");

            expect(pane.scrollTop).toBe(40);
            expect(content.scrollTop).toBe(7);
        });

        it("只有空白等于没搜：视图不动", async () => {
            const {root, q} = await open(twoInEditor());
            typeQuery(searchBox(root), "   ");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
            expect(hidden(q(`.${PANEL_CLASS}__tabs`))).toBe(false);
        });

        it("搜索中迟到的页签恢复不会拆掉结果视图", async () => {
            const host = new FakeHost();
            const release = gatePanelState(host);
            const {root, q} = await open(
                [
                    featureOf("alpha", {category: "editor"}),
                    featureOf("secondary", {category: "appearance"}),
                ],
                {"panel-state": {tab: "appearance"}},
                host,
            );
            typeQuery(searchBox(root), "甲功能");

            release();
            await vi.waitFor(() =>
                expect(q('[data-ss-tab="appearance"]')?.classList.contains("b3-list-item--focus")).toBe(true)
            );

            // 页签换到了「外观」，但结果视图还在：命中视图不被拆掉
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);
            expect(hidden(q('[data-ss-tab-panel="appearance"]'))).toBe(true);
        });

        it("搜索词只存在于本次面板会话：重新打开是空的", async () => {
            const {root, panel} = await open(twoInEditor());
            typeQuery(searchBox(root), "甲");
            panel.close();
            panel.show();

            const reopened = mockState.settings[mockState.settings.length - 1].dialog?.element as HTMLElement;
            expect(searchBox(reopened).value).toBe("");
            expect(reopened.querySelector(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
        });
    });

    describe("搜索期间的状态", () => {
        it("结果里的控件照常可用，改动立即落盘", async () => {
            const {root, q, host} = await open(twoInEditor());
            typeQuery(searchBox(root), "甲");

            const toggle = q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]') as HTMLInputElement;
            toggle.checked = true;
            fire(toggle, "change");

            await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({enabled: true}));
        });

        it("结果里的文本输入照常按静默期落盘，继续搜不会丢掉待写的内容", async () => {
            const {root, q, host} = await open(twoInEditor());
            const search = searchBox(root);
            typeQuery(search, "甲");

            const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]') as HTMLInputElement;
            text.value = "搜索中改的";
            fire(text, "input");
            // 继续在搜索框里打字：结果重算，但控件还是同一份 DOM，没有重建
            typeQuery(search, "甲功");
            expect(q('[data-ss-text="alpha::label"]')).toBe(text);

            await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "搜索中改的"}));
        });

        it("搜索本身不写任何配置", async () => {
            const {root, host} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲");
            typeQuery(input, "功能");
            typeQuery(input, "");
            expect(host.saveData).not.toHaveBeenCalled();
        });

        it("改设置不清空查询、也不重新过滤", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲功能");
            const secondaryRow = q('[data-ss-feature="secondary"]') as HTMLElement;

            const toggle = q<HTMLInputElement>('[data-ss-switch="secondary::enabled"]') as HTMLInputElement;
            toggle.checked = true;
            fire(toggle, "change");

            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(secondaryRow)).toBe(true);
            expect(input.value).toBe("甲功能");
        });

        it("动态文案更新了索引，也不马上改变当前结果；清空再输入才按最新索引算", async () => {
            let options = [{value: "a", label: "alpha.auto"}];
            const {root, q, qa} = await open([featureOf("alpha", {
                settings: [
                    {kind: "switch", key: "enabled", title: "alpha.enabled", default: false},
                    {
                        kind: "select",
                        key: "mode",
                        title: "alpha.mode",
                        default: "a",
                        optionsProvider: () => options,
                    },
                ],
            })]);
            const input = searchBox(root);

            typeQuery(input, "手动");
            const empty = q(`.${PANEL_CLASS}__search-empty`);
            expect(hidden(empty)).toBe(false);

            // 候选集变了，但查询文本没变：当前命中集合不许被打断
            options = [{value: "a", label: "alpha.auto"}, {value: "b", label: "alpha.manual"}];
            typeQuery(input, "手动");
            expect(hidden(empty)).toBe(false);

            // 清空后重新输入：按最新索引重新算
            typeQuery(input, "");
            typeQuery(input, "手动");
            expect(hidden(empty)).toBe(true);
            expect(qa('[data-ss-feature="alpha"]').every((row) => !hidden(row))).toBe(true);
        });
    });

    describe("高亮", () => {
        it("同一段文案里的多个关键词分别高亮", async () => {
            const {root, qa} = await open(twoInEditor());
            typeQuery(searchBox(root), "甲 说明");
            expect(qa(HIT).map((mark) => mark.textContent)).toEqual(["甲", "甲", "说明"]);
        });

        it("高亮只换包装，不解析 HTML：查询里的标签原样当文字", async () => {
            const {root, q} = await open(twoInEditor());
            typeQuery(searchBox(root), '<img src=x onerror="alert(1)">');
            expect(q('[data-ss-feature="alpha"] img')).toBeNull();
            expect(q('[data-ss-feature="alpha"] .config-item__main')?.textContent).toContain("甲功能");
        });

        it("清空搜索后高亮消失、文案复原", async () => {
            const {root, q, qa} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲");
            expect(qa(HIT).length).toBeGreaterThan(0);

            typeQuery(input, "");
            expect(qa(HIT)).toHaveLength(0);
            expect(q('[data-ss-feature="alpha"] .config-item__main')?.textContent).toBe("甲功能甲的说明");
        });

        it("没有命中文字的分组标题与行内说明都不加标记", async () => {
            const {root, qa} = await open(twoInEditor());
            // 命中另一个功能的说明，alpha 整块收起，不该留下任何标记
            typeQuery(searchBox(root), "甲的说明");
            expect(qa(HIT).every((mark) => !mark.closest('[data-ss-feature="secondary"]'))).toBe(true);
        });
    });

    describe("快捷键", () => {
        it("`/` 聚焦搜索框并选中已有查询", async () => {
            const {root} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲");
            input.blur();

            const event = press({key: "/"});
            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(input);
            expect(input.selectionStart).toBe(0);
            expect(input.selectionEnd).toBe(1);
        });

        it("`/` 在编辑控件里不劫持", async () => {
            const {root, q} = await open(twoInEditor());
            const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]') as HTMLInputElement;
            text.focus();

            const event = press({key: "/"});
            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(text);
            expect(searchBox(root).value).toBe("");
        });

        it("Ctrl/Cmd + F 在面板内聚焦搜索框并阻止宿主搜索", async () => {
            const {root} = await open(twoInEditor());
            const input = searchBox(root);
            const event = press({key: "f", ctrlKey: true});
            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(input);
        });

        it("Esc 有查询时只清空搜索、保留焦点、不关面板", async () => {
            const {root, q, panel} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "甲");

            const event = press({key: "Escape"});
            expect(event.defaultPrevented).toBe(true);
            expect(input.value).toBe("");
            expect(document.activeElement).toBe(input);
            expect(panel.isOpen).toBe(true);
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
        });

        it("Esc 没有查询时不拦截，交给宿主", async () => {
            const {root} = await open(twoInEditor());
            searchBox(root).blur();
            const event = press({key: "Escape"});
            expect(event.defaultPrevented).toBe(false);
        });

        it("输入法组合输入期间的按键不当作快捷键", async () => {
            const {root} = await open(twoInEditor());
            const input = searchBox(root);
            input.blur();
            const event = press({key: "/", isComposing: true});
            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).not.toBe(input);
        });

        it("输入法组合输入期间不执行过滤，组合结束才按最终文本过滤", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);

            const composing = new Event("input", {bubbles: true});
            Object.defineProperty(composing, "isComposing", {value: true});
            input.value = "甲功能";
            input.dispatchEvent(composing);
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);

            fire(input, "compositionend");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);
        });
    });

    describe("面板其它状态不受影响", () => {
        it("搜索不改变分类的持久化：关面板写下的仍是当前页签", async () => {
            const {root, host, panel, q} = await open([
                featureOf("alpha", {category: "editor"}),
                featureOf("secondary", {category: "appearance"}),
            ]);
            typeQuery(searchBox(root), "功能");
            panel.close();

            await vi.waitFor(() => expect(host.files.get("feature-panel-state")).toEqual({tab: "editor"}));
            expect(q(`.${PANEL_CLASS}`)).not.toBeNull();
        });
    });
});
