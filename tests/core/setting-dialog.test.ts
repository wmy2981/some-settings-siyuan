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
import {setShowUnavailable} from "../../src/core/availability";
import {ConfigStore} from "../../src/core/config";
import {setDetailedLogging} from "../../src/core/log";
import {
    activeFeatures,
    FEATURES,
} from "../../src/core/registry";
import {
    SEARCH_FEATURE_ID,
    setSearchEnabled,
} from "../../src/core/search";
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
        "alpha.name": "Alpha feature",
        "alpha.desc": "Alpha description",
        "alpha.enabled": "Turn on this feature",
        "alpha.enabled.desc": "Switch description",
        "alpha.size": "Size",
        "alpha.label": "Label",
        "alpha.label.ph": "Enter a label",
        "alpha.mode": "Mode",
        "alpha.auto": "Automatic",
        "alpha.manual": "Manual",
        "alpha.about": "Version {version}\nRepo {repo}",
        "alpha.repo": "Project repository",
        "alpha.run": "Run",
        "alpha.runLabel": "Run now",
        "area.name": "Area feature",
        "area.authors": "Author list",
        "area.authors.desc": "One author per line",
        "area.authors.ph": "Authors placeholder",
        "beta.name": "Unavailable feature",
        "beta.desc": "Description of an unavailable feature",
        "toggle.name": "Show unavailable settings",
        "secondary.name": "Secondary feature",
        "switch-mode.name": "Switch-mode feature",
        "switch-mode.scope": "Platform scope",
        "switch-mode.off": "Off",
        "switch-mode.on": "On",
        "category.editor": "Editor",
        "category.appearance": "Appearance",
        "category.settings": "Settings",
        "common.enabled": "启用",
        "common.scope.desktop": "Desktop",
        "common.scope.mobile": "Mobile",
        "panel.empty": "No available settings on this host",
        "panel.categoryEmpty": "No available feature in this category.",
        "panel.unavailable.group": "Unavailable",
        "panel.unavailable.disabled": "Disabled by the developer",
        "panel.unavailable.userDisabled": "Disabled by your patch",
        "panel.unavailable.frontend": "Only available on {platform}",
        "panel.unavailable.frontendNone": "Not available on any frontend",
        "panel.unavailable.minVersion": "Requires SiYuan {version} or later",
        "panel.unavailable.maxVersion": "Only supported up to SiYuan {version}",
        "panel.search.placeholder": "Search...",
        "panel.search.clear": "Clear search",
        "panel.search.empty": "No results",
        "panel.readonlyTip": "Read-only workspace",
        "action.done": "Action done",
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
    category: ["editor"],
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
    /** 注册表里的全部功能（含不可用的那些），不传就当没有不可用功能。 */
    allFeatures?: FeatureDefinition[],
): Promise<Opened> => {
    const host = existingHost ?? new FakeHost();
    Object.entries(stored).forEach(([id, value]) => host.files.set(`feature-${id}`, value));
    const store = new ConfigStore(host.asPlugin());
    for (const definition of definitions) {
        await store.register(definition);
    }
    const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: definitions, allFeatures});
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
    // 「显示不可用的设置」是模块级的标记（由那个功能挂载 / 卸载翻转）：测试之间必须复位。
    setShowUnavailable(false);
    // 「设置面板搜索」同样由功能挂载翻转；真实插件里它默认开启，测试按同一状态起步。
    setSearchEnabled(true);
    setDetailedLogging(true);
});

afterEach(() => {
    setSearchEnabled(false);
    setDetailedLogging(false);
});

describe("show: render", () => {
    it("opens the dialog through the host Setting, titled with the plugin display name", async () => {
        const {panel, root} = await open();
        expect(panel.isOpen).toBe(true);
        expect(mockState.settings).toHaveLength(1);
        expect(root.querySelector(".b3-dialog__container")).not.toBeNull();
    });

    it("repeated show does not open a second dialog", async () => {
        const {panel} = await open();
        panel.show();
        expect(mockState.settings).toHaveLength(1);
        expect(document.querySelectorAll(".b3-dialog")).toHaveLength(1);
    });

    it("one tab per non-empty category, the first one selected by default", async () => {
        const {qa, q} = await open([
            featureOf("alpha", {category: ["editor"]}),
            featureOf("secondary", {category: ["appearance"]}),
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
        expect(q('[data-ss-tab="editor"] .b3-list-item__text')?.textContent).toBe("Editor");
        // 页签按 FEATURE_CATEGORIES 的顺序排列，缺内容的分类不出现
        expect(qa("[data-ss-tab]")).toHaveLength(2);
    });

    it("a feature in several categories gets a full copy in each tab", async () => {
        const {qa} = await open([featureOf("alpha", {category: ["editor", "appearance"]})]);
        expect(qa("[data-ss-tab]").map((tab) => tab.dataset.ssTab)).toEqual(["editor", "appearance"]);
        const editor = qa('[data-ss-tab-panel="editor"]')[0];
        const appearance = qa('[data-ss-tab-panel="appearance"]')[0];
        expect(editor.querySelectorAll('[data-ss-feature="alpha"]')).toHaveLength(6);
        expect(appearance.querySelectorAll('[data-ss-feature="alpha"]')).toHaveLength(6);
        expect(editor.querySelectorAll('[data-ss-row="alpha::enabled"]')).toHaveLength(1);
        expect(appearance.querySelectorAll('[data-ss-row="alpha::enabled"]')).toHaveLength(1);
    });

    it("changing the copy in one tab updates the copy in the other", async () => {
        const {qa, host} = await open([featureOf("alpha", {category: ["editor", "appearance"]})]);
        const switches = qa('[data-ss-switch="alpha::enabled"]') as HTMLInputElement[];
        expect(switches).toHaveLength(2);
        switches[0].checked = true;
        fire(switches[0], "change");
        await vi.waitFor(() => expect(switches[1].checked).toBe(true));
        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({enabled: true}));
    });

    it("desktop uses the left tab list, not the mobile tab bar", async () => {
        const {panelElement, q} = await open();
        expect(panelElement.classList.contains(`${PANEL_CLASS}--mobile`)).toBe(false);
        expect(q(`.${PANEL_CLASS}__side`)).not.toBeNull();
        expect(q(".layout-tab-bar")).toBeNull();
    });

    it("mobile uses the top tab bar instead", async () => {
        mockState.frontend = "mobile";
        const {panelElement, q} = await open();
        expect(panelElement.classList.contains(`${PANEL_CLASS}--mobile`)).toBe(true);
        expect(q(".layout-tab-bar")).not.toBeNull();
        expect(q(`.${PANEL_CLASS}__side`)).toBeNull();
    });

    it("the feature row carries the name, description and switch, and the switch gets no row of its own", async () => {
        const {q, qa} = await open();
        const row = q('[data-ss-row="alpha::enabled"]');
        expect(row?.tagName).toBe("LABEL");
        expect(row?.textContent).toContain("Alpha feature");
        expect(row?.textContent).toContain("Alpha description");
        // 整页里只有一处 enabled 开关
        expect(qa('[data-ss-switch="alpha::enabled"]')).toHaveLength(1);
    });

    it("a feature switched by a selector promotes that select to the feature row", async () => {
        const {q} = await open([featureOf("switch-mode", {
            category: ["settings"],
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

    it("every field kind renders as its matching control", async () => {
        const {q} = await open();
        expect(q('[data-ss-number="alpha::size"]')?.getAttribute("value")).toBe("12");
        expect(q('[data-ss-number="alpha::size"]')?.closest(".config-item__number")?.textContent).toContain("px");
        const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]');
        expect(text?.value).toBe("hi");
        expect(text?.getAttribute("placeholder")).toBe("Enter a label");
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]');
        expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual(["Automatic", "Manual"]);
        expect(q('[data-ss-button="alpha::run"]')?.textContent).toBe("Run now");
    });

    it("a textarea renders full width with rows, placeholder and description", async () => {
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
        expect(area?.getAttribute("placeholder")).toBe("Authors placeholder");
        const row = area?.closest(".config-item");
        expect(row?.classList.contains(`${PANEL_CLASS}__textarea-row`)).toBe(true);
        expect(row?.textContent).toContain("One author per line");
    });

    it("the last child row of each feature is marked so the guide line ends in a corner", async () => {
        const {qa} = await open([
            featureOf("alpha", {category: ["editor"]}),
            featureOf("secondary", {category: ["editor"]}),
        ]);
        const marked = qa(`.${PANEL_CLASS}__child--last`);
        // 两个功能各一个：末行是那个功能自己的最后一行，不是整页的最后一行
        expect(marked).toHaveLength(2);
        expect(marked.map((row) => row.dataset.ssRow)).toEqual(["alpha::run", "secondary::run"]);
    });

    it("the note block fills placeholders with values and shows links in short form", async () => {
        const {q} = await open();
        const note = q('[data-ss-row="alpha::about"]');
        expect(note?.textContent).toContain("Version 1.0.1");
        const anchor = note?.querySelector("a");
        expect(anchor?.textContent).toBe("owner/repo");
        expect(anchor?.getAttribute("href")).toBe("https://github.com/wmy2981/some-settings-siyuan");
    });

    it("shows an empty state when there is no feature", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: []});
        panel.show();
        const root = mockState.settings[0].dialog!.element;
        expect(root.querySelector(`.${PANEL_CLASS}__empty`)?.textContent).toBe("No available settings on this host");
    });

    it("a function button label is evaluated each time the panel opens", async () => {
        const label = vi.fn((context: FeatureActionContext) => `${context.i18n("alpha.run")} (at runtime)`);
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
        expect(q('[data-ss-button="alpha::run"]')?.textContent).toBe("Run (at runtime)");
    });

    it("an inline SVG icon (iconSvg) is passed through on an action row", async () => {
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

    it("the feature row shows only the title when no description is declared", async () => {
        const {q} = await open([featureOf("alpha", {description: undefined})]);
        const row = q('[data-ss-row="alpha::enabled"]');
        expect(row?.textContent).toContain("Alpha feature");
        expect(row?.querySelector(".b3-label__text")).toBeNull();
    });

    it("a select with neither static options nor a provider renders empty", async () => {
        const {q} = await open([featureOf("alpha", {
            settings: [{kind: "select", key: "mode", title: "alpha.mode", default: "a"}],
        })]);
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]');
        expect(select?.options).toHaveLength(0);
    });

    it("a dynamic select provider is re-evaluated each time the panel opens", async () => {
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

describe("show: host structure differences", () => {
    it("adds the content region when the host omits it and leaves the action region alone", async () => {
        mockState.settingRegionsMissing = true;
        const {root} = await open();
        expect(root.querySelector(".b3-dialog__body > .b3-dialog__content")).not.toBeNull();
        // 面板没有保存 / 取消，宿主没建动作区时也不补
        expect(root.querySelector("[data-ss-save]")).toBeNull();
        expect(root.querySelector("[data-ss-cancel]")).toBeNull();
    });

    it("the title prefers the plugin display name and falls back to the package name", async () => {
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

describe("show: host failures", () => {
    it("a throwing Setting.open() leaves clean state and is reported", async () => {
        mockState.settingOpenError = new Error("host refused");
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(featureOf("alpha"));
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]});

        panel.show();

        expect(panel.isOpen).toBe(false);
        expect(mockState.messages[0].text).toContain("host refused");
    });

    it("leaves nothing behind when the host creates no dialog", async () => {
        mockState.settingDialogMissing = true;
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]});

        panel.show();

        expect(panel.isOpen).toBe(false);
        expect(mockState.messages[0].text).toContain("the host did not create a settings dialog");
    });

    it("closes the dialog and reports when it has no body region", async () => {
        mockState.settingBodyMissing = true;
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const panel = new SettingsPanel({plugin: host.asPlugin(), store, features: [featureOf("alpha")]});

        panel.show();

        expect(mockState.settings[0].closed).toBe(true);
        expect(mockState.messages[0].text).toContain("no body");
    });
});

describe("read-only mode", () => {
    it("every control is disabled and a read-only notice is shown", async () => {
        window.siyuan.config.readonly = true;
        const {q, qa} = await open();
        expect(mockState.messages[0].text).toBe("Read-only workspace");
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

    it("publish mode is treated as read-only too", async () => {
        window.siyuan.isPublish = true;
        const {q} = await open();
        expect(q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')?.disabled).toBe(true);
    });
});

describe("tab interaction", () => {
    const twoTabs = (): FeatureDefinition[] => [
        featureOf("alpha", {category: ["editor"]}),
        featureOf("secondary", {category: ["appearance"]}),
    ];

    it("clicking a tab switches the selection and the visible pane", async () => {
        const {q, qa} = await open(twoTabs());
        (qa("[data-ss-tab]")[1] as HTMLElement).click();

        expect(qa("[data-ss-tab]")[1].classList.contains("b3-list-item--focus")).toBe(true);
        expect(qa("[data-ss-tab]")[0].classList.contains("b3-list-item--focus")).toBe(false);
        expect(q('[data-ss-tab-panel="editor"]')?.classList.contains("fn__none")).toBe(true);
        expect(q('[data-ss-tab-panel="appearance"]')?.classList.contains("fn__none")).toBe(false);
    });

    it("Enter and Space switch tabs while other keys do nothing", async () => {
        const {qa} = await open(twoTabs());
        const second = qa("[data-ss-tab]")[1];
        second.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab"}));
        expect(second.getAttribute("aria-selected")).toBeNull();

        second.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));
        expect(second.getAttribute("aria-selected")).toBe("true");

        qa("[data-ss-tab]")[0].dispatchEvent(new KeyboardEvent("keydown", {key: " "}));
        expect(qa("[data-ss-tab]")[0].getAttribute("aria-selected")).toBe("true");
    });

    it("keyboard switching is ignored while an IME composition is active", async () => {
        const {qa} = await open(twoTabs());
        const second = qa("[data-ss-tab]")[1];
        second.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true}));
        expect(second.getAttribute("aria-selected")).toBeNull();
    });

    it("closing saves the current tab and a new panel restores it", async () => {
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

    it("falls back to the first tab when the remembered one is gone", async () => {
        const {qa} = await open(twoTabs(), {"panel-state": {tab: "settings"}});
        await Promise.resolve();
        await Promise.resolve();
        expect(qa("[data-ss-tab]")[0].getAttribute("aria-selected")).toBe("true");
    });

    it("closing without switching tabs does not rewrite the state", async () => {
        const {host, panel} = await open(twoTabs(), {"panel-state": {tab: "editor"}});
        await vi.waitFor(() => expect(host.loadData).toHaveBeenCalledWith("feature-panel-state"));
        await Promise.resolve();
        panel.close();
        await Promise.resolve();
        expect(host.saveData).not.toHaveBeenCalledWith("feature-panel-state", expect.anything());
    });

    it("unloading the plugin closes the panel and still saves the tab", async () => {
        const {host, panel, qa} = await open(twoTabs());
        qa("[data-ss-tab]")[1].click();
        panel.dispose();
        await vi.waitFor(() => expect(host.files.get("feature-panel-state")).toEqual({tab: "appearance"}));
    });

    it("a failed tab state write surfaces a visible error", async () => {
        const {host, panel, qa} = await open(twoTabs());
        host.rejectWrites = true;
        qa("[data-ss-tab]")[1].click();
        panel.close();
        await vi.waitFor(() =>
            expect(mockState.messages.some((message) => message.text.includes("settings.panel-state"))).toBe(true)
        );
        expect(host.files.get("feature-panel-state")).toBeUndefined();
    });

    it("a manual tab switch wins over a late read of the stored state", async () => {
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

    it("an old panel's async read does not overwrite the reopened tab", async () => {
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

    it("restoring a remembered tab scrolls the mobile tab bar to it", async () => {
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

    it("does not scroll the tab bar when the tab is already fully visible", async () => {
        mockState.frontend = "mobile";
        const {qa, q} = await open(twoTabs());
        const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
        stubScrollBox(bar, qa("[data-ss-tab]")[1], {view: 300, content: 900, start: 80, size: 130});

        qa("[data-ss-tab]")[1].click();

        expect(bar.scrollLeft).toBe(0);
    });

    it("does not scroll at all when the whole tab bar fits", async () => {
        mockState.frontend = "mobile";
        const {qa, q} = await open(twoTabs());
        const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
        stubScrollBox(bar, qa("[data-ss-tab]")[1], {view: 600, content: 600, start: 300, size: 130});

        qa("[data-ss-tab]")[1].click();

        expect(bar.scrollLeft).toBe(0);
    });

    it("scrolls on the next frame when the tab bar has no width yet", async () => {
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

    it("the desktop tab list scrolls the selected tab into view as well", async () => {
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

describe("write on change", () => {
    it("no save or cancel button in the footer and the action region stays collapsed", async () => {
        const {q, qa} = await open();
        expect(qa("[data-ss-save]")).toHaveLength(0);
        expect(qa("[data-ss-cancel]")).toHaveLength(0);
        expect(q(".b3-dialog__action")?.classList.contains("fn__none")).toBe(true);
        expect(q(".b3-dialog__action")?.children).toHaveLength(0);
    });

    it("a switch change is persisted at once without pressing anything", async () => {
        const {q, host} = await open();
        const toggle = q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]')!;
        toggle.checked = true;
        fire(toggle, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({enabled: true}));
        expect(mockState.settings[0].closed).toBe(false);
    });

    it("a select change is persisted at once", async () => {
        const {q, host} = await open();
        const select = q<HTMLSelectElement>('[data-ss-select="alpha::mode"]')!;
        select.value = "manual";
        fire(select, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({mode: "manual"}));
    });

    it("a number is persisted on blur (change) and clamped to min / max", async () => {
        const {q, host} = await open();
        const number = q<HTMLInputElement>('[data-ss-number="alpha::size"]')!;
        number.value = "40";
        fire(number, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({size: 24}));
        expect(number.value).toBe("24");
    });

    it("an emptied number counts as 0 and is clamped to min before saving", async () => {
        // type=number 的输入框拿不到真正的非数字值（非法输入会被浏览器清成空串），
        // 所以这里覆盖的是「清空」这条真实路径：空串 -> 0 -> 夹到 min
        const {q, host} = await open();
        const number = q<HTMLInputElement>('[data-ss-number="alpha::size"]')!;
        number.value = "";
        fire(number, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({size: 8}));
        expect(number.value).toBe("8");
    });

    it("text input coalesces writes within the quiet period, so several keystrokes save once", async () => {
        const {q, host} = await open();
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        for (const value of ["e", "ed", "edited"]) {
            input.value = value;
            fire(input, "input");
        }
        // 静默期没到之前不写
        expect(host.saveData).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "edited"}));
        expect(host.saveData).toHaveBeenCalledTimes(1);
    });

    it("a textarea shares the text quiet period: typing coalesces and blur writes at once", async () => {
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

    it("continuous typing restarts the timer from the last input", async () => {
        vi.useFakeTimers();
        try {
            const {q, host} = await open();
            const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;

            input.value = "a";
            fire(input, "input");
            await vi.advanceTimersByTimeAsync(300);
            input.value = "ab";
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

    it("one feature's immediate write does not swallow another feature's pending write", async () => {
        const {q, host} = await open([featureOf("alpha"), featureOf("beta")]);
        const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        text.value = "pending";
        fire(text, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        // 开关是一次立即提交：它清掉的计时器是共用那一个，必须给还在静默期的 alpha 重新排上
        const toggle = q<HTMLInputElement>('[data-ss-switch="beta::enabled"]')!;
        toggle.checked = true;
        fire(toggle, "change");

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "pending"}));
    });

    it("blurring before the quiet period saves at once and only once", async () => {
        const {q, host} = await open();
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "now";
        fire(input, "input");
        fire(input, "change");

        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));
        expect(host.files.get("feature-alpha")).toMatchObject({label: "now"});
    });

    it("typing during a write does not let the next quiet write carry a stale value", async () => {
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
        input.value = "first pass";
        fire(input, "input");
        fire(input, "change");
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));
        input.value = "second pass";
        fire(input, "input");
        releaseFirstWrite?.();
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(2));
        expect(host.saveData.mock.calls[1]?.[1]).toMatchObject({label: "second pass"});
        expect(host.files.get("feature-alpha")).toMatchObject({label: "second pass"});
        expect(input.value).toBe("second pass");
    });

    it("typing during a write is neither overwritten by the echo nor truncated", async () => {
        const {q, host} = await open();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        host.saveData.mockImplementationOnce(async (name: string, value: unknown): Promise<unknown> => {
            await gate;
            host.files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        // 第一次输入后失焦：立即写盘，写盘卡在 gate 上
        input.value = "first pass";
        fire(input, "input");
        fire(input, "change");
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));

        // 写盘还没回来就继续输入：新内容进下一批，还没进 store
        input.value = "first pass + new text";
        fire(input, "input");
        release();
        // 第一批写盘完成时的回显不能把用户正在输入的内容改回去
        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "first pass"}));
        expect(input.value).toBe("first pass + new text");

        // 再接着敲一个字：落盘的必须是完整内容，不能按被截断的值写
        input.value = `${input.value} again`;
        fire(input, "input");
        await vi.waitFor(() =>
            expect(host.files.get("feature-alpha")).toMatchObject({label: "first pass + new text again"})
        );
    });

    it("closing the panel flushes the edit that has not landed yet", async () => {
        const {q, host, panel} = await open();
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "typed before closing";
        fire(input, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        panel.close();

        await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({label: "typed before closing"}));
    });

    it("re-selecting the same option writes nothing", async () => {
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

    it("a failed write rolls the control back to the stored value and shows the problem", async () => {
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

    it("reopening shows the value read from disk", async () => {
        const {panel} = await open([featureOf("alpha")], {alpha: {enabled: true, label: "stored"}});
        panel.close();
        panel.show();
        const root = mockState.settings[mockState.settings.length - 1].dialog!.element;
        expect(root.querySelector<HTMLInputElement>('[data-ss-text="alpha::label"]')?.value).toBe("stored");
    });
});

describe("action rows", () => {
    it("a click runs at once and receives the feature id, plugin name and a config snapshot", async () => {
        const onClick = vi.fn();
        const {q} = await open([featureOf("alpha", {settings: alphaSettings(onClick)})]);
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();

        await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
        const context = onClick.mock.calls[0][0] as FeatureActionContext;
        expect(context.featureId).toBe("alpha");
        expect(context.pluginName).toBe("some-settings-siyuan");
        expect(context.i18n("alpha.run")).toBe("Run");
        expect(context.i18n("missing.key")).toBe("missing.key");
        const snapshot = context.configOf("alpha");
        expect(snapshot).toMatchObject({enabled: false, label: "hi"});
        // 快照是副本，改了不落盘
        snapshot.label = "local change";
        expect(context.configOf("alpha").label).toBe("hi");
    });

    it("updateConfig writes at once and syncs the switch in the panel", async () => {
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

    it("clear, export and import all forward to the config store", async () => {
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
        await expect(context!.importConfigs({alpha: {enabled: true, label: "restored"}})).resolves.toEqual({
            applied: ["alpha"],
            skipped: [],
        });
        expect(host.files.get("feature-alpha")).toMatchObject({label: "restored"});
    });

    it("clearing drops input still pending in the quiet period", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());

        // 静默期里的一次输入：还没落盘
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "not saved yet";
        fire(input, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: [{name: "feature-alpha", isDir: false}]});
        await expect(context!.clearAllConfigs()).resolves.toBeUndefined();
        expect(host.files.size).toBe(0);

        // 静默期到点后也不能把刚清掉的文件写回来
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(host.saveData).not.toHaveBeenCalled();
        expect(host.files.size).toBe(0);
    });

    it("after a successful clear no input is accepted until the reload", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: [{name: "feature-alpha", isDir: false}]});
        await expect(context!.clearAllConfigs()).resolves.toBeUndefined();
        expect(host.files.size).toBe(0);

        // 面板上还是清空前的值：这时候的输入不能把旧值写回文件
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "typed after clearing";
        fire(input, "input");
        fire(input, "change");
        await new Promise((resolve) => setTimeout(resolve, 450));
        expect(host.saveData).not.toHaveBeenCalled();
        expect(host.files.size).toBe(0);
    });

    it("a failed clear leaves the panel usable", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: [{name: "feature-alpha", isDir: false}]});
        host.removeData.mockResolvedValue({code: 500, msg: "io error"});
        await expect(context!.clearAllConfigs()).rejects.toBeDefined();

        // 没有重载，封锁必须解除：用户还得能改设置
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "editable after failure";
        fire(input, "input");
        fire(input, "change");
        await vi.waitFor(() =>
            expect(host.files.get("feature-alpha")).toMatchObject({label: "editable after failure"})
        );
    });

    it("import flushes pending input first so old input cannot overwrite the imported values", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());

        // 静默期里的一次输入：还没落盘
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "not saved yet";
        fire(input, "input");
        expect(host.saveData).not.toHaveBeenCalled();

        await expect(context!.importConfigs({alpha: {label: "imported value"}})).resolves.toMatchObject({
            applied: ["alpha"],
        });
        // 静默期到点后也不能用旧输入覆盖导入结果
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(host.files.get("feature-alpha")).toMatchObject({label: "imported value"});
    });

    it("after a successful import no input is accepted until the reload", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());
        await expect(context!.importConfigs({alpha: {label: "imported value"}})).resolves.toBeDefined();

        // 面板上还是导入前的值：这时候的输入不能把它写回文件
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "typed after import";
        fire(input, "input");
        fire(input, "change");
        await new Promise((resolve) => setTimeout(resolve, 450));
        expect(host.saveData).toHaveBeenCalledTimes(1);
        expect(host.files.get("feature-alpha")).toMatchObject({label: "imported value"});
    });

    it("a failed import leaves the panel usable", async () => {
        let context: FeatureActionContext | undefined;
        const {q, host} = await open([featureOf("alpha", {
            settings: alphaSettings((actionContext) => {
                context = actionContext;
            }),
        })], {alpha: {enabled: true, label: "x"}});
        (q('[data-ss-button="alpha::run"]') as HTMLElement).click();
        await vi.waitFor(() => expect(context).toBeDefined());
        await expect(context!.importConfigs({alpha: {enabled: "yes"}})).rejects.toBeDefined();

        // 没有重载，封锁必须解除：用户还得能改设置
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "editable after failure";
        fire(input, "input");
        fire(input, "change");
        await vi.waitFor(() =>
            expect(host.files.get("feature-alpha")).toMatchObject({label: "editable after failure"})
        );
    });

    it("cleanup registered by an action row runs on plugin unload and not on panel close", async () => {
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

    it("the function returned by onUnload cancels that single cleanup", async () => {
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

    it("the button stays disabled while running so repeated clicks run once", async () => {
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

    it("a throwing action row is isolated and reported, and the button becomes usable again", async () => {
        const onClick = vi.fn(() => {
            throw new Error("action failed");
        });
        const {q} = await open([featureOf("alpha", {settings: alphaSettings(onClick)})]);
        const button = q<HTMLButtonElement>('[data-ss-button="alpha::run"]')!;

        button.click();

        await vi.waitFor(() => expect(mockState.messages.some((m) => m.text.includes("action failed"))).toBe(true));
        expect(button.disabled).toBe(false);
    });

    it("an action row without a matching onClick only warns and never throws", async () => {
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

describe("buttons at the bottom of a note block", () => {
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

    it("a click runs onClick with a context keyed by feature id + key", async () => {
        const onClick = vi.fn();
        const opened = await open(withActions(onClick));
        const button = opened.q<HTMLButtonElement>(".some-settings-panel__note-actions button")!;
        expect(button.dataset.ssButton).toBe("alpha::star");
        button.click();
        await Promise.resolve();
        expect(onClick).toHaveBeenCalledWith(expect.objectContaining({featureId: "alpha"}));
    });

    it("an inline SVG icon (iconSvg) lands in the button untouched", async () => {
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

    it("the button is disabled in read-only mode", async () => {
        window.siyuan.config.readonly = true;
        const onClick = vi.fn();
        const opened = await open(withActions(onClick));
        const button = opened.q<HTMLButtonElement>(".some-settings-panel__note-actions button")!;
        expect(button.disabled).toBe(true);
    });
});

describe("note block external links", () => {
    it("plugins get a chance to intercept and window.open is used only when none does", async () => {
        const {q} = await open();
        const anchor = q<HTMLAnchorElement>('[data-ss-row="alpha::about"] a')!;
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        anchor.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(window.open).toHaveBeenCalledWith(anchor.href, "_blank");
    });

    it("a plugin object without an event bus is skipped and the link still opens", async () => {
        window.siyuan.ws.app.plugins = [{} as never];
        const {q} = await open();
        const anchor = q<HTMLAnchorElement>('[data-ss-row="alpha::about"] a')!;
        anchor.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(window.open).toHaveBeenCalledWith(anchor.href, "_blank");
    });

    it("no link opens when any plugin's emit returns false", async () => {
        const emit = vi.fn(() => false);
        window.siyuan.ws.app.plugins = [{eventBus: {emit}} as never];
        const {q} = await open();
        const anchor = q<HTMLAnchorElement>('[data-ss-row="alpha::about"] a')!;
        anchor.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));

        expect(emit).toHaveBeenCalledWith("open-link", expect.objectContaining({href: anchor.href}));
        expect(window.open).not.toHaveBeenCalled();
    });
});

describe("failure paths", () => {
    it("a control whose feature is gone only warns and the change is dropped", async () => {
        const {q, panel} = await open();
        (panel as unknown as {options: {features: FeatureDefinition[];};}).options.features = [];
        const input = q<HTMLInputElement>('[data-ss-text="alpha::label"]')!;
        input.value = "discarded";
        expect(() => fire(input, "change")).not.toThrow();
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining("has no matching feature"));
    });

    it("a write that throws without a problem list is still reported", async () => {
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

    it("an unknown control kind is skipped and the rest of the panel works", async () => {
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

describe("layout and width", () => {
    it("desktop computes the width from the viewport and records the measured facts", async () => {
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("900px");
        expect(container.dataset.ssViewport).toBe("1200");
        expect(container.dataset.ssWidth).toBe("900");
        expect(container.dataset.ssNarrow).toBe("false");
    });

    it("a narrow screen keeps a margin and the cap still applies", async () => {
        setViewport(700);
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("676px");
        expect(container.dataset.ssNarrow).toBe("true");
    });

    it("a very narrow viewport stays above the minimum usable width", async () => {
        setViewport(300);
        const {root} = await open();
        expect(root.querySelector<HTMLElement>(".b3-dialog__container")?.style.width).toBe("280px");
    });

    it("the content region does not scroll and has no padding, each pane scrolls itself", async () => {
        const {root} = await open();
        const content = root.querySelector<HTMLElement>(".b3-dialog__content")!;
        expect(content.style.padding).toBe("0px");
        expect(content.style.overflow).toBe("hidden");
    });

    it("no width is written in a standalone settings window, the host fills it", async () => {
        mockState.settingAsWindow = true;
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("");
        expect(container.dataset.ssWidth).toBeUndefined();
    });

    it("no width is written on mobile, the host's bottom drawer owns it", async () => {
        mockState.frontend = "mobile";
        setViewport(420);
        const {root} = await open();
        const container = root.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.style.width).toBe("");
        expect(root.querySelector<HTMLElement>(".b3-dialog__content")?.style.overflow).toBe("auto");
    });

    it("falls back to window.innerWidth when documentElement reports no width", async () => {
        setViewport(0);
        window.innerWidth = 800;
        const {root} = await open();
        expect(root.querySelector<HTMLElement>(".b3-dialog__container")?.style.width).toBe("752px");
    });

    it("the width is recomputed after the viewport changes", async () => {
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

    it("viewport listening stops once the host removes the dialog from the page", async () => {
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

    it("viewport listening stops after closing", async () => {
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

describe("close and dispose", () => {
    it("isOpen is false after close and the panel can open again", async () => {
        const {panel} = await open();
        panel.close();
        expect(panel.isOpen).toBe(false);
        panel.show();
        expect(panel.isOpen).toBe(true);
        expect(mockState.settings).toHaveLength(2);
    });

    it("dispose tears the panel down and is safe to repeat", async () => {
        const {panel} = await open();
        panel.dispose();
        expect(panel.isOpen).toBe(false);
        expect(() => panel.dispose()).not.toThrow();
    });

    it("an exception in a cleanup callback does not bubble out of dispose", async () => {
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
 * 搜索是面板的过滤机制，开关由 `settings-search` 功能承载（默认开启）。这里按三块验证：
 * - 索引与匹配：能搜到什么、关键词怎么算命中；
 * - 显隐与恢复：命中后隐藏分类导航、聚合结果，清空后原样退回；
 * - 期间的状态：控件照常可用、待写文本不丢、高亮与快捷键。
 */
describe("search", () => {
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
        featureOf("alpha", {category: ["editor"]}),
        featureOf("secondary", {category: ["editor"]}),
    ];

    describe("position and initial state", () => {
        it("on desktop the search box sits at the top of the content region above the rows, not in the side bar", async () => {
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

        it("on mobile the search box sits below the panel title and above the tab bar", async () => {
            mockState.frontend = "mobile";
            const {panelElement} = await open(twoInEditor());
            expect(panelElement.children[0]?.className).toContain(`${PANEL_CLASS}__search`);
            expect(panelElement.children[1]?.className).toContain("layout-tab-bar");
        });

        it("opening the panel does not focus the search box, so mobile shows no keyboard", async () => {
            mockState.frontend = "mobile";
            const {root} = await open(twoInEditor());
            expect(document.activeElement).not.toBe(searchBox(root));
        });

        it("the search placeholder comes from i18n", async () => {
            const {root} = await open(twoInEditor());
            expect(searchBox(root).getAttribute("placeholder")).toBe("Search...");
        });

        it("the clear button stays hidden until something is typed", async () => {
            const {root, q} = await open(twoInEditor());
            const clear = q("[data-ss-search-clear]") as HTMLButtonElement;
            expect(hidden(clear)).toBe(true);

            typeQuery(searchBox(root), "Alpha");
            expect(hidden(clear)).toBe(false);

            typeQuery(searchBox(root), "");
            expect(hidden(clear)).toBe(true);
        });

        it("clicking clear returns to the category view and keeps the focus in the search box", async () => {
            const {root, q, panel} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha feature");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);

            (q("[data-ss-search-clear]") as HTMLButtonElement).click();

            expect(input.value).toBe("");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(false);
            expect(document.activeElement).toBe(input);
            expect(panel.isOpen).toBe(true);
        });

        it("the clear button hides again after Esc clears the query", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            const clear = q("[data-ss-search-clear]") as HTMLButtonElement;
            typeQuery(input, "Alpha");
            expect(hidden(clear)).toBe(false);

            press({key: "Escape"});
            expect(input.value).toBe("");
            expect(hidden(clear)).toBe(true);
        });
    });

    describe("the feature switch", () => {
        /** 「设置面板搜索」本身也是一个功能：默认开启，面板靠它的配置变化显隐搜索框。 */
        const searchFeature = (): FeatureDefinition =>
            featureOf(SEARCH_FEATURE_ID, {
                category: ["plugin"],
                settings: [{kind: "switch", key: "enabled", title: "alpha.enabled", default: true}],
            });

        it("hides the search box and leaves every search shortcut to the host when it is off", async () => {
            setSearchEnabled(false);
            const {root, q} = await open(twoInEditor());

            expect(hidden(q(`.${PANEL_CLASS}__search`))).toBe(true);
            expect(press({key: "f", ctrlKey: true}).defaultPrevented).toBe(false);
            expect(press({key: "/"}).defaultPrevented).toBe(false);
            expect(document.activeElement).not.toBe(searchBox(root));
        });

        it("turning it off while the panel is open hides the box and returns an active search to the category view", async () => {
            const {q, panelElement, store} = await open([...twoInEditor(), searchFeature()]);
            const input = q<HTMLInputElement>("[data-ss-search]") as HTMLInputElement;
            typeQuery(input, "Alpha");
            expect(panelElement.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);

            setSearchEnabled(false);
            await store.patch(SEARCH_FEATURE_ID, {enabled: false});

            expect(hidden(q(`.${PANEL_CLASS}__search`))).toBe(true);
            expect(input.value).toBe("");
            expect(panelElement.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(false);

            setSearchEnabled(true);
            await store.patch(SEARCH_FEATURE_ID, {enabled: true});
            expect(hidden(q(`.${PANEL_CLASS}__search`))).toBe(false);
        });
    });

    describe("index and matching", () => {
        it("internal ids and field keys are always searchable and ignore case", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "ALPHA");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);

            typeQuery(input, "SIZE");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
        });

        it("every keyword must land on one field: a hit cannot be assembled across fields", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            const empty = q(`.${PANEL_CLASS}__search-empty`);

            // 「功能」只在功能名里，「说明」只在功能说明里：一个字段都凑不齐
            typeQuery(input, "feature description");
            expect(hidden(empty)).toBe(false);
            // 同一个字段里都有 → 命中（说明是「甲的说明」）
            typeQuery(input, "alpha description");
            expect(hidden(empty)).toBe(true);
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
        });

        it("a textarea placeholder is part of the search index", async () => {
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
            typeQuery(searchBox(root), "Authors placeholder");
            expect(hidden(q('[data-ss-feature="area"]'))).toBe(false);
        });

        it("the language versions of static text share one match domain, so a hit in another language is not highlighted", async () => {
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

        it("a category name hit shows every feature of that category", async () => {
            const {root, q} = await open([
                featureOf("alpha", {category: ["editor"]}),
                featureOf("secondary", {category: ["appearance"]}),
            ]);
            const input = searchBox(root);

            typeQuery(input, "Editor");
            expect(hidden(q('[data-ss-feature="alpha"]'))).toBe(false);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);
            expect(hidden(q('[data-ss-tab-panel="appearance"]'))).toBe(true);
            expect(hidden(q('[data-ss-search-group="editor"]'))).toBe(false);
            // 分类名命中也要能聚合成结果视图：导航收起、面板挂上搜索类
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(SEARCH.replace(".", ""))).toBe(true);
        });

        it("a feature in several categories shows up under every matching group", async () => {
            const {root, qa} = await open([featureOf("alpha", {category: ["editor", "appearance"]})]);
            typeQuery(searchBox(root), "Alpha feature");
            expect(qa('[data-ss-tab-panel="editor"]')[0].classList.contains("fn__none")).toBe(false);
            expect(qa('[data-ss-tab-panel="appearance"]')[0].classList.contains("fn__none")).toBe(false);
            const rows = qa('[data-ss-feature="alpha"]');
            expect(rows).toHaveLength(12);
            expect(rows.every((row) => !row.classList.contains("fn__none"))).toBe(true);
            // 分类名命中只翻出一组：搜「Editor」时外观组仍然收起
            typeQuery(searchBox(root), "Editor");
            expect(qa('[data-ss-tab-panel="appearance"]')[0].classList.contains("fn__none")).toBe(true);
        });

        it("a feature hit shows all its visible settings, including fields that did not match", async () => {
            const {root, q, qa} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "Alpha description");
            const rows = qa('[data-ss-feature="alpha"]');
            // 开关行 + 数字 + 文本 + 下拉 + 说明块 + 动作行
            expect(rows).toHaveLength(6);
            expect(rows.every((row) => !hidden(row))).toBe(true);
            expect(q('[data-ss-feature="secondary"]')?.classList.contains("fn__none")).toBe(true);
        });

        it("categories and features keep the declared order instead of a relevance order", async () => {
            // 声明顺序是「外观」在前，但结果分组按 FEATURE_CATEGORIES 的顺序（编辑器在前）
            const {root, qa} = await open([
                featureOf("secondary", {category: ["appearance"]}),
                featureOf("alpha", {category: ["editor"]}),
            ]);
            typeQuery(searchBox(root), "feature");
            const groups = qa("[data-ss-search-group]")
                .filter((group) => !hidden(group))
                .map((group) => group.dataset.ssSearchGroup);
            expect(groups).toEqual(["editor", "appearance"]);
        });

        it("with no results only the empty state shows, with no empty categories and no clear button", async () => {
            const {root, q, qa} = await open(twoInEditor());
            typeQuery(searchBox(root), "no such setting");

            expect(qa("[data-ss-tab-panel]").every((pane) => hidden(pane))).toBe(true);
            const empty = q(`.${PANEL_CLASS}__search-empty`);
            expect(hidden(empty)).toBe(false);
            expect(empty?.textContent).toBe("No results");
            expect(qa(HIT)).toHaveLength(0);
        });
    });

    describe("visibility and restore", () => {
        it("a query collapses the category navigation but keeps the search box", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha");

            // 桌面端整根左侧栏（分类列表）收起，搜索框在内容区里，照旧可用。
            // 收起交给 `--search` 那段 CSS 的宽度过渡：这里刻意不加 fn__none，
            // display:none 会让收起 / 展开变成硬跳
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(q(`.${PANEL_CLASS}__side`))).toBe(false);
            expect(hidden(input.closest(`.${PANEL_CLASS}__search`))).toBe(false);
            expect(hidden(q(`.${PANEL_CLASS}__views`))).toBe(false);
        });

        it("on mobile the top tab bar collapses through a transition rather than display:none", async () => {
            mockState.frontend = "mobile";
            const {root, q, panelElement} = await open(twoInEditor());
            typeQuery(searchBox(root), "Alpha");
            expect(panelElement.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            // 收起交给 `--search` 那段 height 过渡：塞 fn__none 就没有过渡，一开一收是硬跳
            expect(hidden(q(".layout-tab-bar"))).toBe(false);
        });

        it("on mobile the measured tab bar height goes to CSS before collapsing and is handed back to the content afterwards", async () => {
            mockState.frontend = "mobile";
            const {root, q} = await open(twoInEditor());
            const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
            // jsdom 量不出高度，这里给一个「内容撑出来的高度」
            const measured = vi.spyOn(bar, "offsetHeight", "get").mockReturnValue(42);
            const input = searchBox(root);

            typeQuery(input, "Alpha");
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

        it("searching during the transition does not take the mid-animation height as the start", async () => {
            mockState.frontend = "mobile";
            const {root, q} = await open(twoInEditor());
            const bar = q<HTMLElement>(".layout-tab-bar") as HTMLElement;
            const measured = vi.spyOn(bar, "offsetHeight", "get").mockReturnValue(42);
            const input = searchBox(root);

            typeQuery(input, "Alpha");
            // 展开途中高度还在动画里（量到 0），这时候再搜一次不能拿 0 覆盖掉起点
            typeQuery(input, "");
            measured.mockReturnValue(0);
            typeQuery(input, "Alpha");

            expect(bar.style.getPropertyValue("--ss-tabbar-height")).toBe("42px");
            measured.mockRestore();
        });

        it("clearing restores categories, tabs, rows and the last-row mark", async () => {
            const {root, q, qa} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "Alpha description");
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

        it("switching queries repeatedly still leaves one last-row mark per pane", async () => {
            const {root, qa} = await open(twoInEditor());
            const input = searchBox(root);

            for (const query of ["Alpha feature", "Secondary feature", "Alpha feature"]) {
                typeQuery(input, query);
                const marked = qa(".config-item--last-visible");
                expect(marked).toHaveLength(1);
                const visible = qa(".config-item").filter((row) => !hidden(row));
                expect(marked[0]).toBe(visible[visible.length - 1]);
            }
        });

        it("clearing the search leaves no adjacent text nodes", async () => {
            const {root, qa} = await open(twoInEditor());
            const input = searchBox(root);
            // 只命中标题的第一个字：高亮会把「甲功能」切成 mark + 文本两段，
            // 收尾时如果不合并相邻文本节点，这里就会留下两个并排的 Text
            typeQuery(input, "Alpha");
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

        it("after filtering the closing mark still lands on the last child row of each visible feature", async () => {
            const {root, qa} = await open(twoInEditor());
            const input = searchBox(root);

            typeQuery(input, "Alpha feature");
            const duringSearch = qa(`.${PANEL_CLASS}__child--last`);
            expect(duringSearch).toHaveLength(1);
            expect(duringSearch[0].dataset.ssRow).toBe("alpha::run");

            typeQuery(input, "");
            expect(qa(`.${PANEL_CLASS}__child--last`).map((row) => row.dataset.ssRow))
                .toEqual(["alpha::run", "secondary::run"]);
        });

        it("clearing returns to the scroll position from before the search", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            const pane = q('[data-ss-tab-panel="editor"]') as HTMLElement;
            const content = q(".b3-dialog__content") as HTMLElement;
            pane.scrollTop = 40;
            content.scrollTop = 7;

            typeQuery(input, "Alpha");
            // 搜索期间视图换成了结果列，滚动位置另算
            typeQuery(input, "");

            expect(pane.scrollTop).toBe(40);
            expect(content.scrollTop).toBe(7);
        });

        it("whitespace alone counts as no search and the view stays put", async () => {
            const {root, q} = await open(twoInEditor());
            typeQuery(searchBox(root), "   ");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
            expect(hidden(q(`.${PANEL_CLASS}__tabs`))).toBe(false);
        });

        it("a late tab restore during a search does not tear down the result view", async () => {
            const host = new FakeHost();
            const release = gatePanelState(host);
            const {root, q} = await open(
                [
                    featureOf("alpha", {category: ["editor"]}),
                    featureOf("secondary", {category: ["appearance"]}),
                ],
                {"panel-state": {tab: "appearance"}},
                host,
            );
            typeQuery(searchBox(root), "Alpha feature");

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

        it("the query lives only in this panel session, so reopening starts empty", async () => {
            const {root, panel} = await open(twoInEditor());
            typeQuery(searchBox(root), "Alpha");
            panel.close();
            panel.show();

            const reopened = mockState.settings[mockState.settings.length - 1].dialog?.element as HTMLElement;
            expect(searchBox(reopened).value).toBe("");
            expect(reopened.querySelector(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
        });
    });

    describe("state during a search", () => {
        it("controls in the results stay usable and changes are persisted at once", async () => {
            const {root, q, host} = await open(twoInEditor());
            typeQuery(searchBox(root), "Alpha");

            const toggle = q<HTMLInputElement>('[data-ss-switch="alpha::enabled"]') as HTMLInputElement;
            toggle.checked = true;
            fire(toggle, "change");

            await vi.waitFor(() => expect(host.files.get("feature-alpha")).toMatchObject({enabled: true}));
        });

        it("text input in the results still saves through the quiet period and searching on keeps the pending text", async () => {
            const {root, q, host} = await open(twoInEditor());
            const search = searchBox(root);
            typeQuery(search, "Alpha");

            const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]') as HTMLInputElement;
            text.value = "edited while searching";
            fire(text, "input");
            // 继续在搜索框里打字：结果重算，但控件还是同一份 DOM，没有重建
            typeQuery(search, "Alpha feat");
            expect(q('[data-ss-text="alpha::label"]')).toBe(text);

            await vi.waitFor(() =>
                expect(host.files.get("feature-alpha")).toMatchObject({label: "edited while searching"})
            );
        });

        it("searching itself writes no config", async () => {
            const {root, host} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha");
            typeQuery(input, "feature");
            typeQuery(input, "");
            expect(host.saveData).not.toHaveBeenCalled();
        });

        it("changing a setting neither clears the query nor refilters", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha feature");
            const secondaryRow = q('[data-ss-feature="secondary"]') as HTMLElement;

            const toggle = q<HTMLInputElement>('[data-ss-switch="secondary::enabled"]') as HTMLInputElement;
            toggle.checked = true;
            fire(toggle, "change");

            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(secondaryRow)).toBe(true);
            expect(input.value).toBe("Alpha feature");
        });

        it("updated dynamic text refreshes the index without changing current results, and only a new query after clearing uses it", async () => {
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

            typeQuery(input, "Manual");
            const empty = q(`.${PANEL_CLASS}__search-empty`);
            expect(hidden(empty)).toBe(false);

            // 候选集变了，但查询文本没变：当前命中集合不许被打断
            options = [{value: "a", label: "alpha.auto"}, {value: "b", label: "alpha.manual"}];
            typeQuery(input, "Manual");
            expect(hidden(empty)).toBe(false);

            // 清空后重新输入：按最新索引重新算
            typeQuery(input, "");
            typeQuery(input, "Manual");
            expect(hidden(empty)).toBe(true);
            expect(qa('[data-ss-feature="alpha"]').every((row) => !hidden(row))).toBe(true);
        });
    });

    describe("highlighting", () => {
        it("each keyword in the same text is highlighted separately", async () => {
            const {root, qa} = await open(twoInEditor());
            typeQuery(searchBox(root), "alpha description");
            expect(qa(HIT).map((mark) => mark.textContent)).toEqual(["Alpha", "Alpha", "description"]);
        });

        it("highlighting only wraps text and never parses HTML, so tags in the query stay literal", async () => {
            const {root, q} = await open(twoInEditor());
            typeQuery(searchBox(root), '<img src=x onerror="alert(1)">');
            expect(q('[data-ss-feature="alpha"] img')).toBeNull();
            expect(q('[data-ss-feature="alpha"] .config-item__main')?.textContent).toContain("Alpha feature");
        });

        it("clearing the search removes the highlights and restores the text", async () => {
            const {root, q, qa} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha");
            expect(qa(HIT).length).toBeGreaterThan(0);

            typeQuery(input, "");
            expect(qa(HIT)).toHaveLength(0);
            expect(q('[data-ss-feature="alpha"] .config-item__main')?.textContent).toBe(
                "Alpha featureAlpha description",
            );
        });

        it("group titles and inline descriptions without a matched word carry no mark", async () => {
            const {root, qa} = await open(twoInEditor());
            // 命中另一个功能的说明，alpha 整块收起，不该留下任何标记
            typeQuery(searchBox(root), "Alpha description");
            expect(qa(HIT).every((mark) => !mark.closest('[data-ss-feature="secondary"]'))).toBe(true);
        });
    });

    describe("shortcuts", () => {
        it("`/` focuses the search box and selects the existing query", async () => {
            const {root} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha");
            input.blur();

            const event = press({key: "/"});
            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(input);
            expect(input.selectionStart).toBe(0);
            expect(input.selectionEnd).toBe(5);
        });

        it("`/` is not hijacked inside an editing control", async () => {
            const {root, q} = await open(twoInEditor());
            const text = q<HTMLInputElement>('[data-ss-text="alpha::label"]') as HTMLInputElement;
            text.focus();

            const event = press({key: "/"});
            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(text);
            expect(searchBox(root).value).toBe("");
        });

        it("Ctrl/Cmd + F focuses the search box in the panel and blocks the host search", async () => {
            const {root} = await open(twoInEditor());
            const input = searchBox(root);
            const event = press({key: "f", ctrlKey: true});
            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(input);
        });

        it("Esc with a query only clears the search, keeping the focus and the panel open", async () => {
            const {root, q, panel} = await open(twoInEditor());
            const input = searchBox(root);
            typeQuery(input, "Alpha");

            const event = press({key: "Escape"});
            expect(event.defaultPrevented).toBe(true);
            expect(input.value).toBe("");
            expect(document.activeElement).toBe(input);
            expect(panel.isOpen).toBe(true);
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);
        });

        it("Esc without a query is not intercepted and goes to the host", async () => {
            const {root} = await open(twoInEditor());
            searchBox(root).blur();
            const event = press({key: "Escape"});
            expect(event.defaultPrevented).toBe(false);
        });

        it("keys pressed during an IME composition are not treated as shortcuts", async () => {
            const {root} = await open(twoInEditor());
            const input = searchBox(root);
            input.blur();
            const event = press({key: "/", isComposing: true});
            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).not.toBe(input);
        });

        it("no filtering runs during an IME composition and the final text filters once it ends", async () => {
            const {root, q} = await open(twoInEditor());
            const input = searchBox(root);

            const composing = new Event("input", {bubbles: true});
            Object.defineProperty(composing, "isComposing", {value: true});
            input.value = "Alpha feature";
            input.dispatchEvent(composing);
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(false);

            fire(input, "compositionend");
            expect(q(`.${PANEL_CLASS}`)?.classList.contains(`${PANEL_CLASS}--search`)).toBe(true);
            expect(hidden(q('[data-ss-feature="secondary"]'))).toBe(true);
        });
    });

    describe("other panel state is unaffected", () => {
        it("searching does not change persisted state, closing still writes the current tab", async () => {
            const {root, host, panel, q} = await open([
                featureOf("alpha", {category: ["editor"]}),
                featureOf("secondary", {category: ["appearance"]}),
            ]);
            typeQuery(searchBox(root), "feature");
            panel.close();

            await vi.waitFor(() => expect(host.files.get("feature-panel-state")).toEqual({tab: "editor"}));
            expect(q(`.${PANEL_CLASS}`)).not.toBeNull();
        });
    });
});

describe("unavailable settings", () => {
    /** 控制开关的那个功能：面板靠它的配置变化重画不可用条目。 */
    const toggleOf = (): FeatureDefinition => ({
        id: "show-unavailable-settings",
        category: ["plugin"],
        name: "toggle.name",
        enabled: true,
        settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
    });

    /** 一个不可用的功能：默认是开发者禁用，可以换成别的原因。 */
    const betaOf = (extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
        id: "beta",
        category: ["editor"],
        name: "beta.name",
        description: "beta.desc",
        enabled: true,
        settings: [
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
            {kind: "number", key: "size", title: "alpha.size", default: 12, min: 8, max: 24},
        ],
        ...extra,
    });

    const hiddenOf = (element: Element | null | undefined): boolean => Boolean(element?.classList.contains("fn__none"));

    /** 某个功能在磁盘上的配置被读了几次。 */
    const readsOf = (host: FakeHost, id: string): number =>
        host.loadData.mock.calls.filter((call) => call[0] === `feature-${id}`).length;

    /** 某个页签里属于某个功能的行（不可用条目在分类页与汇总页各有一份，按页签分开看）。 */
    const rowsIn = (
        pane: Element | null,
        featureId: string,
    ): HTMLElement[] => [...(pane?.querySelectorAll<HTMLElement>(`[data-ss-feature="${featureId}"]`) ?? [])];

    it("unavailable items stay hidden until the switch grays them in at the bottom of the tab with a reason", async () => {
        const {q, store, panelElement} = await open(
            [featureOf("alpha"), toggleOf()],
            {},
            undefined,
            [featureOf("alpha"), toggleOf(), betaOf({enabled: false})],
        );
        const pane = q('[data-ss-tab-panel="editor"]');
        const betaRows = rowsIn(pane, "beta");
        expect(betaRows.length).toBeGreaterThan(0);
        expect(betaRows.every(hiddenOf)).toBe(true);
        expect(panelElement.classList.contains(`${PANEL_CLASS}--show-unavailable`)).toBe(false);

        // 打开开关：功能被装载器挂载、标记翻转；面板收到配置变化后把条目露出来
        setShowUnavailable(true);
        await store.patch("show-unavailable-settings", {enabled: true});

        expect(panelElement.classList.contains(`${PANEL_CLASS}--show-unavailable`)).toBe(true);
        expect(betaRows.every((row) => !hiddenOf(row))).toBe(true);
        // 整块灰显，控件不可操作
        expect(betaRows.every((row) => row.classList.contains(`${PANEL_CLASS}__unavailable`))).toBe(true);
        expect(pane?.querySelector<HTMLInputElement>('[data-ss-number="beta::size"]')?.disabled).toBe(true);
        expect(pane?.querySelector<HTMLInputElement>('[data-ss-switch="beta::enabled"]')?.disabled).toBe(true);
        // 原因行排在这个功能的最后一行
        expect(betaRows[betaRows.length - 1].textContent).toContain("Disabled by the developer");
        // 排在可用功能之后（同一页里）
        const alphaRows = rowsIn(pane, "alpha");
        expect(
            alphaRows[alphaRows.length - 1].compareDocumentPosition(betaRows[0]) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("every reason is spelled out: developer, user patch, platform, no platform, both versions", async () => {
        setShowUnavailable(true);
        const {q} = await open(
            [featureOf("alpha"), toggleOf()],
            {},
            undefined,
            [
                featureOf("alpha"),
                toggleOf(),
                betaOf({id: "off-demo", enabled: false}),
                // 用户级补丁关掉的功能：原因要写成「用户禁用」，不能混成开发者禁用
                betaOf({id: "patch-off", enabled: false, fromPatch: {enabled: false}}),
                betaOf({id: "mobile-demo", frontends: ["mobile"]}),
                // 补丁把适用端设成空数组：两端都不适用，没有端名可填
                betaOf({id: "nowhere-demo", frontends: []}),
                betaOf({id: "new-demo", minAppVersion: "9.0.0"}),
                betaOf({id: "old-demo", maxAppVersion: "3.0.0"}),
            ],
        );
        const pane = q('[data-ss-tab-panel="editor"]');
        const reasonOf = (id: string): string => rowsIn(pane, id).pop()?.textContent ?? "";
        expect(reasonOf("off-demo")).toContain("Disabled by the developer");
        expect(reasonOf("patch-off")).toContain("Disabled by your patch");
        expect(reasonOf("patch-off")).not.toContain("Disabled by the developer");
        expect(reasonOf("mobile-demo")).toContain("Only available on Mobile");
        expect(reasonOf("nowhere-demo")).toContain("Not available on any frontend");
        expect(reasonOf("new-demo")).toContain("Requires SiYuan 9.0.0 or later");
        expect(reasonOf("old-demo")).toContain("Only supported up to SiYuan 3.0.0");
    });

    it("several matching reasons are listed one by one instead of just the first", async () => {
        // 只在移动端存在、又已经超出最高版本：桌面端这两条同时成立
        window.siyuan.config.system.kernelVersion = "3.9.0";
        setShowUnavailable(true);
        const {q} = await open(
            [featureOf("alpha"), toggleOf()],
            {},
            undefined,
            [
                featureOf("alpha"),
                toggleOf(),
                betaOf({id: "multi", frontends: ["mobile"], maxAppVersion: "3.8.10-alpha.1"}),
            ],
        );
        const pane = q('[data-ss-tab-panel="editor"]');
        const reasonRow = rowsIn(pane, "multi").pop();
        const lines = [...(reasonRow?.querySelectorAll(`.${PANEL_CLASS}__unavailable-reason-text`) ?? [])]
            .map((line) => line.textContent);
        expect(lines).toEqual(["Only available on Mobile", "Only supported up to SiYuan 3.8.10-alpha.1"]);
    });

    it("a category without available features shows a hint that the switch replaces with grayed rows", async () => {
        const {q, store} = await open(
            [featureOf("alpha"), toggleOf()],
            {},
            undefined,
            [
                featureOf("alpha"),
                toggleOf(),
                betaOf({id: "beta", category: ["appearance"], enabled: false}),
            ],
        );
        // 「外观」分类只有不可用的功能：页签仍然出现
        expect(q('[data-ss-tab="appearance"]')).not.toBeNull();
        const pane = q('[data-ss-tab-panel="appearance"]');
        const empty = pane?.querySelector(`.${PANEL_CLASS}__category-empty`);
        expect(empty?.textContent).toBe("No available feature in this category.");
        expect(hiddenOf(empty)).toBe(false);
        expect(rowsIn(pane, "beta").every(hiddenOf)).toBe(true);

        setShowUnavailable(true);
        await store.patch("show-unavailable-settings", {enabled: true});

        expect(hiddenOf(empty)).toBe(true);
        expect(rowsIn(pane, "beta").every((row) => !hiddenOf(row))).toBe(true);
    });

    it("items are gathered at the very bottom of the results and cannot be found while the switch is off", async () => {
        const {q, root, store} = await open(
            [featureOf("alpha", {category: ["editor"]}), toggleOf()],
            {},
            undefined,
            [
                featureOf("alpha", {category: ["editor"]}),
                toggleOf(),
                betaOf({category: ["appearance"], enabled: false}),
            ],
        );
        const input = root.querySelector<HTMLInputElement>("[data-ss-search]") as HTMLInputElement;
        input.value = "Unavailable feature";
        input.dispatchEvent(new Event("input", {bubbles: true}));

        const dedicated = q('[data-ss-tab-panel="__unavailable"]');
        expect(dedicated).not.toBeNull();
        expect(hiddenOf(dedicated)).toBe(true);
        expect(hiddenOf(q(`.${PANEL_CLASS}__search-empty`))).toBe(false);

        setShowUnavailable(true);
        await store.patch("show-unavailable-settings", {enabled: true});

        expect(hiddenOf(dedicated)).toBe(false);
        const group = dedicated?.querySelector('[data-ss-search-group="__unavailable"]');
        expect(group?.textContent).toBe("Unavailable");
        expect(hiddenOf(group)).toBe(false);
        // 汇总页排在所有分类页之后：结果最底部
        const panes = [...root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]")];
        expect(panes[panes.length - 1]).toBe(dedicated);
        // 分类页里那一份在搜索期间收起
        expect(hiddenOf(q('[data-ss-tab-panel="appearance"]'))).toBe(true);

        // 搜「不可用」这三个字（分组名本身）同样能把这一组翻出来
        input.value = "Unavailable";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        expect(rowsIn(dedicated, "beta").every((row) => !hiddenOf(row))).toBe(true);

        // 分类名命中时，该分类里不可用的功能也跟着进「不可用」分组
        input.value = "Appearance";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        expect(rowsIn(dedicated, "beta").every((row) => !hiddenOf(row))).toBe(true);

        // 开关关掉后立刻收起，结果回到「无结果」
        setShowUnavailable(false);
        await store.patch("show-unavailable-settings", {enabled: false});
        expect(hiddenOf(dedicated)).toBe(true);
    });

    it("a retired feature in several categories is found by any of their names", async () => {
        const {q, root, store} = await open(
            [featureOf("alpha", {category: ["editor"]}), toggleOf()],
            {},
            undefined,
            [
                featureOf("alpha", {category: ["editor"]}),
                toggleOf(),
                betaOf({category: ["appearance", "editor"], enabled: false}),
            ],
        );
        setShowUnavailable(true);
        await store.patch("show-unavailable-settings", {enabled: true});
        const dedicated = q('[data-ss-tab-panel="__unavailable"]');
        const input = root.querySelector<HTMLInputElement>("[data-ss-search]") as HTMLInputElement;
        input.value = "Editor";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        expect(rowsIn(dedicated, "beta").every((row) => !hiddenOf(row))).toBe(true);
    });

    it("retired features from the real registry render too, without throwing and with a reason", async () => {
        // 3.9.0 已超过几个「上游实现了就退场」功能的最高版本，它们会以不可用的形式出现
        window.siyuan.config.system.kernelVersion = "3.9.0";
        setShowUnavailable(true);
        const {q, qa} = await open(activeFeatures(), {}, undefined, FEATURES);

        const retired = q('[data-ss-tab-panel="doc-tree"] [data-ss-feature="doc-tree-title-markdown"]');
        expect(retired).not.toBeNull();
        expect(retired?.classList.contains(`${PANEL_CLASS}__unavailable`)).toBe(true);
        expect(qa('[data-ss-tab-panel="doc-tree"] [data-ss-feature="doc-tree-title-markdown"]').pop()?.textContent)
            .toContain("Only supported up to SiYuan 3.8.10-alpha.1");
        // 只在移动端存在的功能在桌面端也画得出来，原因是平台
        expect(qa('[data-ss-tab-panel="appearance"] [data-ss-feature="mobile-dock-blur"]').pop()?.textContent)
            .toContain("Only available on Mobile");
    });

    it("clearing the search returns unavailable items to their category panes and they still follow the switch", async () => {
        setShowUnavailable(true);
        const {q, root} = await open(
            [featureOf("alpha", {category: ["editor"]}), toggleOf()],
            {},
            undefined,
            [
                featureOf("alpha", {category: ["editor"]}),
                toggleOf(),
                betaOf({category: ["editor"], enabled: false}),
            ],
        );
        const pane = q('[data-ss-tab-panel="editor"]');
        expect(rowsIn(pane, "beta").every((row) => !hiddenOf(row))).toBe(true);

        const input = root.querySelector<HTMLInputElement>("[data-ss-search]") as HTMLInputElement;
        input.value = "alpha";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        expect(rowsIn(pane, "beta").every(hiddenOf)).toBe(true);

        input.value = "";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        expect(rowsIn(pane, "beta").every((row) => !hiddenOf(row))).toBe(true);
    });

    it("grayed rows show the stored configuration instead of the declared defaults", async () => {
        setShowUnavailable(true);
        const {q, store, host} = await open(
            [featureOf("alpha"), toggleOf()],
            {beta: {enabled: true, size: 20}},
            undefined,
            [featureOf("alpha"), toggleOf(), betaOf({enabled: false})],
        );
        const pane = q('[data-ss-tab-panel="editor"]');
        const size = pane?.querySelector<HTMLInputElement>('[data-ss-number="beta::size"]');
        const toggle = pane?.querySelector<HTMLInputElement>('[data-ss-switch="beta::enabled"]');
        // 面板先按声明默认值画出来，配置文件读回来之后再换成存过的值
        await vi.waitFor(() => expect(size?.value).toBe("20"));
        expect(toggle?.checked).toBe(true);
        // 搜索结果里那一份同样是存过的值
        const dedicated = q('[data-ss-tab-panel="__unavailable"]');
        expect(dedicated?.querySelector<HTMLInputElement>('[data-ss-number="beta::size"]')?.value).toBe("20");
        // 只是显示：控件依然不可操作，配置也没有因此被装载进 store
        expect(size?.disabled).toBe(true);
        expect(toggle?.disabled).toBe(true);
        expect(store.get("beta")).toEqual({});
        expect(host.files.get("feature-beta")).toEqual({enabled: true, size: 20});
    });

    it("the unavailable configuration is read only once the switch is on, and only once per panel", async () => {
        const {q, store, host} = await open(
            [featureOf("alpha"), toggleOf()],
            {beta: {enabled: true, size: 20}},
            undefined,
            [featureOf("alpha"), toggleOf(), betaOf({enabled: false})],
        );
        const size = (): HTMLInputElement | null => q<HTMLInputElement>('[data-ss-number="beta::size"]');
        // 开关关着时那些行根本不显示，配置文件也就不读
        expect(readsOf(host, "beta")).toBe(0);
        expect(size()?.value).toBe("12");

        setShowUnavailable(true);
        await store.patch("show-unavailable-settings", {enabled: true});
        await vi.waitFor(() => expect(size()?.value).toBe("20"));
        expect(readsOf(host, "beta")).toBe(1);

        // 关了再开不重复读盘：这一次打开的面板里那份值还在
        setShowUnavailable(false);
        await store.patch("show-unavailable-settings", {enabled: false});
        expect(size()?.value).toBe("20");
        setShowUnavailable(true);
        await store.patch("show-unavailable-settings", {enabled: true});
        expect(size()?.value).toBe("20");
        expect(readsOf(host, "beta")).toBe(1);
    });

    it("a feature without a stored file keeps the declared defaults", async () => {
        setShowUnavailable(true);
        const {q} = await open(
            [featureOf("alpha"), toggleOf()],
            {},
            undefined,
            [featureOf("alpha"), toggleOf(), betaOf({enabled: false})],
        );
        const pane = q('[data-ss-tab-panel="editor"]');
        await vi.waitFor(() =>
            expect(pane?.querySelector<HTMLInputElement>('[data-ss-number="beta::size"]')?.value).toBe("12")
        );
        expect(pane?.querySelector<HTMLInputElement>('[data-ss-switch="beta::enabled"]')?.checked).toBe(false);
    });
});
