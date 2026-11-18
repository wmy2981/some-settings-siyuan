/**
 * 按作者屏蔽集市包。
 *
 * 这个功能有两块容易错的地方，测试按这两块组织：
 *
 * 1. **名单解析与匹配**：完全匹配（不做子串）、忽略大小写、空行与空白不能意外屏蔽任何东西；
 * 2. **跟着宿主重绘对账**：集市列表是整块重写的（排序 / 筛选 / 虚拟化补卡都会换节点），
 *    屏蔽必须落在新节点上；计数修正与「全部被屏蔽」提示依赖宿主实际拿到的包数组，
 *    而列表是虚拟化的、DOM 里数不全，所以另有一条响应观察者与一条兜底请求。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {
    FeatureConfig,
    FeatureInstance,
} from "../../src/core/types";
import {
    isAuthorBlocked,
    parseAuthorList,
} from "../../src/features/bazaar-author-blocklist/authors";
import definition from "../../src/features/bazaar-author-blocklist/index";
import {
    bazaarTypeOfUrl,
    createBazaarListTap,
    packagesOfResponse,
    visiblePackagesOf,
} from "../../src/features/bazaar-author-blocklist/list";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

const BLOCKED = "data-ss-bazaar-blocked";
const ALL_BLOCKED = "data-ss-bazaar-all-blocked";
const HINT = "data-ss-bazaar-blocked-hint";

const cardMarkup = (
    author: string,
    name: string,
    options: {source?: string; type?: string;} = {},
): string =>
    `<div class="b3-card" data-name="${name}" data-package-type="${options.type ?? "plugins"}"
    data-package-source="${options.source ?? "bazaar"}">
    <div class="b3-card__img"></div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info">${name}</div>
        <div class="b3-card__actions"><span class="b3-card__author">${author}</span></div>
    </div>
</div>`;

const placeholderMarkup = (index: number): string => `<div class="b3-card" data-bazaar-index="${index}"></div>`;

const panelMarkup = (
    type: "plugin" | "theme",
    cards: string[],
    counter: number,
): string => {
    const id = type === "plugin" ? "configBazaarPlugin" : "configBazaarTheme";
    return `<div class="config-bazaar__panel" data-type="${type}">
    <div class="fn__flex config-bazaar__title"><div class="counter">${counter}</div></div>
    <div id="${id}" class="config-bazaar__content"><div class="b3-cards">${cards.join("")}</div></div>
</div>`;
};

const panelOf = (): HTMLElement => document.querySelector<HTMLElement>("#configBazaarPlugin") as HTMLElement;
const counterOf = (): HTMLElement => document.querySelector<HTMLElement>(".counter") as HTMLElement;
const cardOf = (name: string): HTMLElement =>
    document.querySelector<HTMLElement>(`.b3-card[data-name="${name}"]`) as HTMLElement;
const isHidden = (name: string): boolean => cardOf(name).hasAttribute(BLOCKED);

const fakeResponse = (payload: unknown) => ({
    clone: () => ({json: async () => payload}),
});

const packagesPayload = (...items: {author: string; name: string;}[]) => ({
    code: 0,
    data: {packages: items},
});

/** 让宿主（以及我们的响应观察者）看到的列表响应。 */
const stubListFetch = (payload: unknown) => {
    const stub = vi.fn(async () => fakeResponse(payload));
    (window as unknown as {fetch: unknown;}).fetch = stub;
    return stub;
};

describe("author list", () => {
    it("splits by line, trims whitespace and blank lines, normalises case and dedupes", () => {
        expect([...parseAuthorList(" Acme \r\n\r\nacme\nfoo")]).toEqual(["acme", "foo"]);
        expect([...parseAuthorList("   \n\n  ")]).toEqual([]);
        expect([...parseAuthorList(undefined)]).toEqual([]);
        expect([...parseAuthorList(42)]).toEqual([]);
    });

    it("matches exactly: no substring matching, case-insensitive, no hit for an empty author", () => {
        const authors = parseAuthorList("AcMe");
        expect(isAuthorBlocked("acme", authors)).toBe(true);
        expect(isAuthorBlocked("ACME", authors)).toBe(true);
        expect(isAuthorBlocked(" acme ", authors)).toBe(true);
        expect(isAuthorBlocked("acme2", authors)).toBe(false);
        expect(isAuthorBlocked("ac", authors)).toBe(false);
        expect(isAuthorBlocked("", authors)).toBe(false);
        expect(isAuthorBlocked(undefined, authors)).toBe(false);
        expect(isAuthorBlocked("acme", new Set())).toBe(false);
    });
});

describe("list data", () => {
    it("maps API URLs to the five online lists and rejects every other URL", () => {
        expect(bazaarTypeOfUrl("/api/bazaar/getBazaarPlugin")).toBe("plugins");
        expect(bazaarTypeOfUrl("http://127.0.0.1:6806/api/bazaar/getBazaarTheme")).toBe("themes");
        expect(bazaarTypeOfUrl("/api/bazaar/getBazaarIcon")).toBe("icons");
        expect(bazaarTypeOfUrl("/api/bazaar/getBazaarTemplate")).toBe("templates");
        expect(bazaarTypeOfUrl("/api/bazaar/getBazaarWidget")).toBe("widgets");
        expect(bazaarTypeOfUrl("/api/bazaar/getBazaarPackage")).toBeUndefined();
        expect(bazaarTypeOfUrl("/api/file/readDir")).toBeUndefined();
    });

    it("accepts only responses with code=0 and a packages array", () => {
        expect(packagesOfResponse(packagesPayload({author: "a", name: "p"}))).toEqual([{author: "a", name: "p"}]);
        expect(packagesOfResponse({code: 1, data: {packages: []}})).toBeUndefined();
        expect(packagesOfResponse({code: 0, data: null})).toBeUndefined();
        expect(packagesOfResponse({code: 0, data: {packages: "x"}})).toBeUndefined();
        expect(packagesOfResponse(null)).toBeUndefined();
    });

    it("copies the host visibility filter: compatibility first, then theme mode", () => {
        const packages = [
            {author: "a", name: "ok"},
            {author: "a", name: "old", bazaarVersionUnsupported: true},
            {author: "a", name: "platform", bazaarIncompatible: true},
            {author: "a", name: "dark", modes: ["dark"]},
            {author: "a", name: "any"},
        ];
        const filters = {hideUnsupportedVersion: true, hideIncompatiblePlatform: true};
        expect(visiblePackagesOf(packages, "plugins", undefined, filters).map((item) => item.name))
            .toEqual(["ok", "dark", "any"]);
        expect(visiblePackagesOf(packages, "themes", "0", filters).map((item) => item.name))
            .toEqual(["ok", "any"]);
        expect(visiblePackagesOf(packages, "themes", "1", filters).map((item) => item.name))
            .toEqual(["ok", "dark", "any"]);
        // 主题明暗只对 themes 生效
        expect(visiblePackagesOf(packages, "plugins", "0", undefined).map((item) => item.name))
            .toEqual(["ok", "old", "platform", "dark", "any"]);
    });

    it("the response tap only reads online list endpoints and reports failures to the caller", async () => {
        const received: string[] = [];
        const errors: unknown[] = [];
        const good = fakeResponse(packagesPayload({author: "a", name: "p"}));
        const bad = {
            clone: () => ({
                json: async () => {
                    throw new Error("bad body");
                },
            }),
        };
        const stub = vi.fn(async (input: RequestInfo | URL) => String(input).includes("Theme") ? bad : good);
        (window as unknown as {fetch: unknown;}).fetch = stub;
        const restore = createBazaarListTap(
            (type) => received.push(type),
            (_message, error) => errors.push(error),
        );

        await window.fetch("/api/bazaar/getBazaarPlugin", {method: "POST"});
        // 详情接口不在观察范围内
        await window.fetch("/api/bazaar/getBazaarPackage", {method: "POST"});
        await vi.waitFor(() => expect(received).toEqual(["plugins"]));
        expect(errors).toEqual([]);

        // 读副本失败只影响计数修正，不能让宿主请求失败
        await window.fetch("/api/bazaar/getBazaarTheme", {method: "POST"});
        await vi.waitFor(() => expect(errors).toHaveLength(1));

        restore();
        expect(window.fetch).toBe(stub);
    });
});

describe("mounting into the online bazaar list", () => {
    const instances: HostHarness[] = [];

    /** 让出几轮任务：对账在微任务里，响应观察者与兜底请求还各要走一次异步。 */
    const flushFrames = async (): Promise<void> => {
        for (let round = 0; round < 12; round++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };

    const mount = (config: FeatureConfig = {enabled: true, authors: "acme"}): HostHarness => {
        const harness = mountFeature(definition, {
            config,
            i18n: (key) => key === "feature.bazaarAuthorBlocklist.allBlocked" ? "hidden {count}" : key,
        });
        instances.push(harness);
        return harness;
    };

    afterEach(() => {
        instances.splice(0).forEach((harness) => harness.dispose());
    });

    it("hides only cards in the online list whose author matches, leaving other cards and the downloaded list alone", async () => {
        document.body.innerHTML = `
            ${panelMarkup("plugin", [cardMarkup("acme", "pkg"), cardMarkup("other", "keep")], 2)}
            <div class="config-bazaar__panel" data-type="downloaded">
                <div id="configBazaarDownloaded" class="config-bazaar__content">
                    <div class="b3-cards">${cardMarkup("acme", "installed", {source: "downloaded"})}</div>
                </div>
            </div>`;
        mount();
        await flushFrames();

        expect(isHidden("pkg")).toBe(true);
        expect(isHidden("keep")).toBe(false);
        expect(isHidden("installed")).toBe(false);
    });

    it("verbose logs record mounting, taking over the list, counter corrections and unmounting", async () => {
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "a"), cardMarkup("other", "b")], 2);
        stubListFetch(packagesPayload({author: "acme", name: "a"}, {author: "other", name: "b"}));
        const harness = mount();
        await flushFrames();
        await window.fetch("/api/bazaar/getBazaarPlugin", {method: "POST"});
        await flushFrames();
        harness.dispose();

        const lines = harness.records.logs.map((args) => String(args[0]));
        expect(lines).toContain("marketplace author blocklist mounted (1 author(s))");
        expect(lines).toContain("tracking the plugins marketplace list");
        expect(lines).toContain("read 2 plugins packages from a list response");
        expect(lines).toContain("hid 1 of 2 plugins packages");
        expect(lines).toContain("marketplace author blocklist unmounted");
        expect(harness.records.logLevels).not.toContain("warn");
    });

    it("ignores case and does no substring matching", async () => {
        document.body.innerHTML = panelMarkup("plugin", [
            cardMarkup("ACME", "upper"),
            cardMarkup("acme2", "suffix"),
            cardMarkup("AcMe", "mixed"),
        ], 3);
        mount({enabled: true, authors: "acme"});
        await flushFrames();

        expect(isHidden("upper")).toBe(true);
        expect(isHidden("suffix")).toBe(false);
        expect(isHidden("mixed")).toBe(true);
    });

    it("hides new cards after the host re-renders the whole block (sorting / filtering)", async () => {
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "pkg")], 1);
        mount();
        await flushFrames();
        expect(isHidden("pkg")).toBe(true);

        // 宿主切换排序时就是这么干的：容器内容整块换成新节点
        panelOf().innerHTML = `<div class="b3-cards">${cardMarkup("acme", "pkg")}</div>`;
        await flushFrames();

        expect(isHidden("pkg")).toBe(true);
    });

    it("virtualisation backfill: hides a real card that replaces a placeholder", async () => {
        document.body.innerHTML = panelMarkup("plugin", [placeholderMarkup(24)], 1);
        mount();
        await flushFrames();

        // 宿主滚动到附近时用真实卡片替换占位卡
        const placeholder = document.querySelector<HTMLElement>("[data-bazaar-index]") as HTMLElement;
        placeholder.outerHTML = cardMarkup("acme", "pkg");
        await flushFrames();

        expect(isHidden("pkg")).toBe(true);
    });

    it("reconciles again after the bazaar tab remounts with a replaced container", async () => {
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "pkg")], 1);
        mount();
        await flushFrames();
        expect(isHidden("pkg")).toBe(true);

        // 关掉设置再打开：整个面板换了一份节点
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "pkg")], 1);
        await flushFrames();

        expect(isHidden("pkg")).toBe(true);
    });

    it("applies a changed list immediately without waiting for a redraw", async () => {
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "pkg"), cardMarkup("other", "keep")], 2);
        const harness = mount();
        await flushFrames();
        expect(isHidden("pkg")).toBe(true);

        harness.config.authors = "other";
        harness.notifyConfigChange();
        await flushFrames();

        expect(isHidden("pkg")).toBe(false);
        expect(isHidden("keep")).toBe(true);

        harness.config.authors = "";
        harness.notifyConfigChange();
        await flushFrames();
        expect(isHidden("keep")).toBe(false);
    });

    it("rewrites the counter to the blocked count using the list from the response", async () => {
        document.body.innerHTML = panelMarkup("plugin", [
            cardMarkup("acme", "pkg"),
            cardMarkup("other", "keep"),
            cardMarkup("third", "keep2"),
        ], 3);
        stubListFetch(packagesPayload(
            {author: "acme", name: "pkg"},
            {author: "other", name: "keep"},
            {author: "third", name: "keep2"},
        ));
        mount();
        await flushFrames();

        await window.fetch("/api/bazaar/getBazaarPlugin", {method: "POST"});
        await flushFrames();

        expect(counterOf().textContent).toBe("2");
    });

    it("issues its own request for counter data when enabled after the list has rendered", async () => {
        document.body.innerHTML = panelMarkup("plugin", [
            cardMarkup("acme", "pkg"),
            cardMarkup("other", "keep"),
        ], 2);
        mockState.fetchSyncPost.mockResolvedValue(packagesPayload(
            {author: "acme", name: "pkg"},
            {author: "other", name: "keep"},
        ));
        mount();
        await flushFrames();

        expect(counterOf().textContent).toBe("1");
    });

    it("enabled first, authors later: still fixes the counter once the list is already rendered", async () => {
        document.body.innerHTML = panelMarkup("plugin", [
            cardMarkup("acme", "pkg"),
            cardMarkup("other", "keep"),
        ], 2);
        mockState.fetchSyncPost.mockResolvedValue(packagesPayload(
            {author: "acme", name: "pkg"},
            {author: "other", name: "keep"},
        ));
        const harness = mount({enabled: true, authors: ""});
        await flushFrames();
        // 名单是空的：不拉数据、不动计数
        expect(counterOf().textContent).toBe("2");

        harness.config.authors = "acme";
        harness.notifyConfigChange();
        await flushFrames();

        expect(isHidden("pkg")).toBe(true);
        expect(counterOf().textContent).toBe("1");
    });

    it("collapses the card grid, adds an explanatory line and zeroes the counter when everything is blocked", async () => {
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "a"), cardMarkup("acme", "b")], 2);
        stubListFetch(packagesPayload({author: "acme", name: "a"}, {author: "acme", name: "b"}));
        const harness = mount();
        await flushFrames();
        await window.fetch("/api/bazaar/getBazaarPlugin", {method: "POST"});
        await flushFrames();

        expect(counterOf().textContent).toBe("0");
        expect(panelOf().hasAttribute(ALL_BLOCKED)).toBe(true);
        const hint = panelOf().querySelector(`[${HINT}]`);
        expect(hint?.textContent).toBe("hidden 2");

        // 放开名单：网格与计数都回到宿主的样子
        harness.config.authors = "";
        harness.notifyConfigChange();
        await flushFrames();
        expect(panelOf().hasAttribute(ALL_BLOCKED)).toBe(false);
        expect(panelOf().querySelector(`[${HINT}]`)).toBeNull();
        expect(counterOf().textContent).toBe("2");
    });

    it("leaves the counter alone when its list disagrees with the host counter (waits for a new response)", async () => {
        document.body.innerHTML = panelMarkup("plugin", [
            cardMarkup("acme", "pkg"),
            cardMarkup("other", "keep"),
            cardMarkup("third", "keep2"),
        ], 5);
        stubListFetch(packagesPayload(
            {author: "acme", name: "pkg"},
            {author: "other", name: "keep"},
            {author: "third", name: "keep2"},
        ));
        mount();
        await flushFrames();
        await window.fetch("/api/bazaar/getBazaarPlugin", {method: "POST"});
        await flushFrames();

        // 宿主计数器是 5、我们手里只有 3 个包：说明数据不是当前列表，保持原样
        expect(counterOf().textContent).toBe("5");
    });

    it("returns the counter, card markers and hint to the host on unmount", async () => {
        document.body.innerHTML = panelMarkup("plugin", [cardMarkup("acme", "a"), cardMarkup("acme", "b")], 2);
        stubListFetch(packagesPayload({author: "acme", name: "a"}, {author: "acme", name: "b"}));
        const harness = mount();
        await flushFrames();
        await window.fetch("/api/bazaar/getBazaarPlugin", {method: "POST"});
        await flushFrames();
        expect(counterOf().textContent).toBe("0");

        harness.dispose();

        expect(counterOf().textContent).toBe("2");
        expect(panelOf().querySelector(`[${HINT}]`)).toBeNull();
        expect(panelOf().hasAttribute(ALL_BLOCKED)).toBe(false);
        expect(document.querySelectorAll(`[${BLOCKED}]`)).toHaveLength(0);
    });
});

describe("feature declaration", () => {
    it("defaults to off, with a switch as the first setting row and the author list as a textarea", () => {
        expect(definition.id).toBe("bazaar-author-blocklist");
        expect(definition.category).toBe("settings");
        expect(definition.enabled).toBe(true);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        const authors = definition.settings.find((field) => field.key === "authors");
        expect(authors).toMatchObject({kind: "textarea", default: "", rows: 6});
    });

    it("the cleanup function returned by mount is idempotent", () => {
        const harness = mountFeature(definition, {config: {enabled: true, authors: ""}});
        const instance = harness.instance as FeatureInstance;
        expect(typeof instance.destroy).toBe("function");
        instance.destroy?.();
        instance.destroy?.();
        harness.dispose();
    });
});
