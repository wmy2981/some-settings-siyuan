/**
 * 集市包自定义图标。
 *
 * 这个功能的界面部分（往集市卡片上贴图）只是「跟着 DOM 重绘对账」，真正容易错的是**文件层**：
 * 文件名是唯一的数据源（`作者__包名.扩展名`），解析错一位就贴错包、甚至把文件写到目录外；
 * 内核的文件 API 又不能拿「没报错」当成功（与 `saveData` 同一个坑）。
 * 所以这里的断言集中在：
 *
 * 1. `parseIconFileName` 的穷举 —— 分隔符取第一个 `__`、扩展名取最后一个点、白名单之外一律不收；
 * 2. `listIcons` / `readIconDataUrl` 对内核各种应答形状的处理（成功、过滤坏条目、404、code≠0、缺字段、
 *    内核把文件读不到时返回的 JSON 错误体）；
 * 3. 管理窗口的核心分支 —— 列表渲染与排序、失败重试、保存时**自动打开功能**（动作行不进草稿，
 *    不这么做用户配完图标却看不到任何变化，docs/setting-panel.md 的 `button` 动作行）、恢复原图标。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {SettingField} from "../../src/core/types";
import {mountBazaarCustomIcon} from "../../src/features/bazaar-custom-icon/apply";
import {
    ICON_CHANGED_EVENT,
    iconDirOf,
    imageFromBase64,
    imageFromFile,
    listIcons,
    parseIconFileName,
    readIconDataUrl,
} from "../../src/features/bazaar-custom-icon/icons";
import definition from "../../src/features/bazaar-custom-icon/index";
import {openIconManager} from "../../src/features/bazaar-custom-icon/manager";
import {createActionContext} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

const PLUGIN = "some-settings-siyuan";
const ICON_DIR = `/data/storage/petal/${PLUGIN}/icons`;

/** 一张最小的 PNG 文件头：只需要字节原样往返，不需要真的是张能显示的图。 */
const pngBytes = (): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

interface FakeResponseInit {
    ok?: boolean;
    status?: number;
    contentType?: string;
    bytes?: Uint8Array;
    json?: unknown;
}

/**
 * `fetch` 的最小 Response 替身。
 *
 * `readIconDataUrl` / `writeIcon` 只用到 `ok` / `status` / `headers.get("content-type")` /
 * `blob()` / `arrayBuffer()` / `json()`，手搓一份比引 undici 的 Response 更可控。
 */
const fakeResponse = (init: FakeResponseInit = {}) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {get: (): string => init.contentType ?? ""},
    blob: async () =>
        new Blob([(init.bytes ?? new Uint8Array()) as unknown as BlobPart], {
            type: init.contentType ?? "",
        }),
    arrayBuffer: async () => (init.bytes ?? new Uint8Array()).buffer,
    json: async () => init.json ?? {},
});

/** 渲染出来的每一行。 */
const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(".ss-bazaar-icon-manager__row"));

/** 管理窗口的选项替身；`unloads` 收集起来供 afterEach 统一收窗。 */
const unloads: (() => void)[] = [];

const makeOptions = (overrides: Record<string, unknown> = {}) => {
    const options = {
        pluginName: PLUGIN,
        i18n: (key: string) => key,
        onUnload: (listener: () => void) => {
            unloads.push(listener);
            return () => {
                const index = unloads.indexOf(listener);
                if (index >= 0) {
                    unloads.splice(index, 1);
                }
            };
        },
        isEnabled: vi.fn(() => false),
        enable: vi.fn(async () => undefined),
        ...overrides,
    };
    return options;
};

/**
 * 按接口地址回一个内核响应。
 *
 * `mockState.fetchSyncPost` 的签名是「任意入参」，直接给它一个 `(api: string)` 的实现会
 * 因为参数逆变而通不过类型检查；这里统一收窄一次，用例里只关心地址。
 */
const respond = (handler: (api: string) => unknown): void => {
    mockState.fetchSyncPost.mockImplementation(async (...args: unknown[]) => handler(String(args[0])));
};

describe("集市包自定义图标", () => {
    afterEach(() => {
        // 管理窗口挂在模块级变量上，不主动收掉会把上一份 DOM 与监听带进下一个用例
        unloads.splice(0).forEach((listener) => listener());
        delete (globalThis as unknown as Record<string, unknown>).fetch;
    });

    describe("iconDirOf", () => {
        it("指向插件存储目录下的 icons/，不带多余的斜杠", () => {
            expect(iconDirOf("some-settings-siyuan")).toBe("/data/storage/petal/some-settings-siyuan/icons");
            expect(iconDirOf("x")).toBe("/data/storage/petal/x/icons");
            expect(iconDirOf("x").endsWith("/")).toBe(false);
        });
    });

    describe("parseIconFileName", () => {
        it("拆出作者、包名、扩展名，并把工作区绝对路径拼好", () => {
            expect(parseIconFileName(PLUGIN, "wmy2981__some-settings-siyuan.png")).toEqual({
                fileName: "wmy2981__some-settings-siyuan.png",
                owner: "wmy2981",
                name: "some-settings-siyuan",
                ext: "png",
                path: `${ICON_DIR}/wmy2981__some-settings-siyuan.png`,
            });
        });

        it("扩展名统一转小写：目录里是 .PNG 时给 <img> 的 MIME 才不会落到 octet-stream", () => {
            expect(parseIconFileName(PLUGIN, "acme__pkg.PNG")?.ext).toBe("png");
            expect(parseIconFileName(PLUGIN, "acme__pkg.SvG")?.ext).toBe("svg");
        });

        it("包名里可以有多个点与单个下划线：扩展名只取最后一个点", () => {
            const icon = parseIconFileName(PLUGIN, "acme__my.pkg_v2.name.webp");
            expect(icon).toEqual({
                fileName: "acme__my.pkg_v2.name.webp",
                owner: "acme",
                name: "my.pkg_v2.name",
                ext: "webp",
                path: `${ICON_DIR}/acme__my.pkg_v2.name.webp`,
            });
        });

        it("分隔符取第一个 `__`：包名里再出现 `__` 也只是包名的一部分", () => {
            const icon = parseIconFileName(PLUGIN, "acme__a__b.gif");
            expect(icon?.owner).toBe("acme");
            expect(icon?.name).toBe("a__b");
            expect(icon?.ext).toBe("gif");
        });

        it("白名单里的九种扩展名都收", () => {
            ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].forEach((ext) => {
                const icon = parseIconFileName(PLUGIN, `acme__pkg.${ext}`);
                expect(icon?.ext).toBe(ext);
                expect(icon?.path).toBe(`${ICON_DIR}/acme__pkg.${ext}`);
            });
        });

        it("不是图片后缀的一律不收（文件里放着什么由读盘那一侧负责）", () => {
            ["txt", "exe", "json", "html", "zip", "js", "png.txt"].forEach((ext) => {
                expect(parseIconFileName(PLUGIN, `acme__pkg.${ext}`)).toBeUndefined();
            });
        });

        it("缺分隔符、缺包名、缺扩展名、扩展名为空都不收", () => {
            [
                "acme.png",
                "acmepkg",
                "__pkg.png",
                "acme__pkg",
                "acme__.png",
                "acme__pkg.",
                "acme__",
            ].forEach((fileName) => {
                expect(parseIconFileName(PLUGIN, fileName)).toBeUndefined();
            });
        });

        it("作者或包名含目录分隔符、点、空格等不安全字符时拒绝：不允许拼出目录穿越", () => {
            [
                "ac/me__pkg.png",
                "acme__p/ kg.png",
                "acme__ pkg.png",
                "../acme__pkg.png",
                "..__pkg.png",
                "acme__...png",
                "acme__pkg.png/evil.png",
            ].forEach((fileName) => {
                expect(parseIconFileName(PLUGIN, fileName)).toBeUndefined();
            });
        });

        it("包名带点且最后一个点后面没有字符（以点结尾）不收", () => {
            expect(parseIconFileName(PLUGIN, "acme__my.pkg.")).toBeUndefined();
        });

        it("文件名原样保留在 fileName 上：它就是这张图标的唯一标识", () => {
            const icon = parseIconFileName(PLUGIN, "acme__Pkg.PNG");
            expect(icon?.fileName).toBe("acme__Pkg.PNG");
        });
    });

    describe("listIcons", () => {
        it("列出目录并把不合规条目、子目录、缺名字的条目一并过滤掉", async () => {
            mockState.fetchSyncPost.mockResolvedValue({
                code: 0,
                data: [
                    {name: "acme__pkg.png", isDir: false},
                    {name: "acme__other.svg", isDir: false},
                    {name: "subdir", isDir: true},
                    {name: "notes.txt", isDir: false},
                    {isDir: false},
                    {name: 42, isDir: false},
                    {name: "acme__pkg.png", isDir: false},
                ],
            });

            const icons = await listIcons(PLUGIN);

            // 同名文件出现两次也照样列两次：目录里确实躺着两个（删除失败留下的）
            expect(icons.map((icon) => icon.fileName)).toEqual(["acme__pkg.png", "acme__other.svg", "acme__pkg.png"]);
            expect(icons[0].path).toBe(`${ICON_DIR}/acme__pkg.png`);
        });

        it("请求参数：读图标目录、进程内直连、任何 code 都兑现（process=false）", async () => {
            await listIcons(PLUGIN);

            expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
                "/api/file/readDir",
                {path: ICON_DIR},
                undefined,
                false,
            );
        });

        it("目录不存在（404）按「一张图标都没有」处理，不报错", async () => {
            mockState.fetchSyncPost.mockResolvedValue({code: 404, msg: "not found"});
            await expect(listIcons(PLUGIN)).resolves.toEqual([]);
        });

        it("其它非 0 code 抛出并带上 code 与 msg：读不到目录不能退化成「没有图标」", async () => {
            mockState.fetchSyncPost.mockResolvedValue({code: 500, msg: "boom"});
            await expect(listIcons(PLUGIN)).rejects.toThrow(
                `cannot list ${ICON_DIR}: code 500: boom`,
            );

            mockState.fetchSyncPost.mockResolvedValue({code: -1});
            await expect(listIcons(PLUGIN)).rejects.toThrow(`cannot list ${ICON_DIR}: code -1`);
        });

        it("data 缺失或不是数组时按空目录处理", async () => {
            mockState.fetchSyncPost.mockResolvedValue({code: 0});
            await expect(listIcons(PLUGIN)).resolves.toEqual([]);

            mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {name: "acme__pkg.png"}});
            await expect(listIcons(PLUGIN)).resolves.toEqual([]);
        });
    });

    describe("readIconDataUrl", () => {
        it("把文件字节转成 data URL，并始终按扩展名写回 MIME", async () => {
            const fetchMock = vi.fn(async () =>
                fakeResponse({contentType: "application/octet-stream", bytes: pngBytes()})
            );
            vi.stubGlobal("fetch", fetchMock);
            const icon = parseIconFileName(PLUGIN, "acme__pkg.png")!;

            const url = await readIconDataUrl(icon);

            expect(url.startsWith("data:image/png;base64,")).toBe(true);
            // 内核偶尔回 octet-stream；<img> 里的 SVG 必须拿到 image/svg+xml 才会被当图渲染
            expect(fetchMock).toHaveBeenCalledWith("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: `${ICON_DIR}/acme__pkg.png`}),
            });
        });

        it("SVG 的 MIME 由扩展名决定，不受内核给的 Content-Type 影响", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async () =>
                    fakeResponse({contentType: "application/octet-stream", bytes: new TextEncoder().encode("<svg/>")})
                ),
            );
            const icon = parseIconFileName(PLUGIN, "acme__pkg.svg")!;

            const url = await readIconDataUrl(icon);

            expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
        });

        it("HTTP 失败直接抛出，不去解析响应体", async () => {
            const json = vi.fn();
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => ({
                    ok: false,
                    status: 404,
                    headers: {get: (): string => ""},
                    json,
                })),
            );
            const icon = parseIconFileName(PLUGIN, "acme__pkg.png")!;

            await expect(readIconDataUrl(icon)).rejects.toThrow(`cannot read ${icon.path}: HTTP 404`);
            expect(json).not.toHaveBeenCalled();
        });

        it("内核用 JSON 错误体回复读不到文件时，抛出 code 与 msg 而不是把 JSON 当图", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async () =>
                    fakeResponse({contentType: "application/json; charset=utf-8", json: {code: 404, msg: "not found"}})
                ),
            );
            const icon = parseIconFileName(PLUGIN, "acme__pkg.png")!;

            await expect(readIconDataUrl(icon)).rejects.toThrow(`cannot read ${icon.path}: code 404: not found`);

            vi.stubGlobal(
                "fetch",
                vi.fn(async () => fakeResponse({contentType: "application/json", json: {code: 500}})),
            );
            await expect(readIconDataUrl(icon)).rejects.toThrow(`cannot read ${icon.path}: code 500`);
        });
    });

    describe("功能声明", () => {
        it("默认关闭的开关 + 管理入口 + 说明块，动作按钮打开管理窗口", async () => {
            expect(definition.id).toBe("bazaar-custom-icon");
            expect(definition.category).toBe("settings");
            expect(definition.enabled).toBe(true);
            expect(definition.settings.map((field) => field.key)).toEqual(["enabled", "manage", "notice"]);
            expect(definition.settings[0]).toEqual({
                kind: "switch",
                key: "enabled",
                title: "common.enabled",
                default: false,
            });

            const action = createActionContext({
                featureId: "bazaar-custom-icon",
                config: {enabled: false},
                pluginName: PLUGIN,
            });
            const button = definition.settings[1] as Extract<SettingField, {kind: "button";}>;
            await button.onClick(action.context);

            // 开关关着也能先配图标：入口不依赖功能挂载
            expect(document.querySelector(".ss-bazaar-icon-manager__list")).not.toBeNull();
            expect(document.body.textContent).toContain("feature.bazaarCustomIcon.tip");
        });

        it("动作行保存图标后立刻打开功能，并把草稿同步成 enabled: true", async () => {
            const iconEntries: {name: string; isDir: boolean;}[] = [];
            respond((api) => {
                if (api === "/api/file/readDir") {
                    return {code: 0, data: iconEntries};
                }
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            vi.stubGlobal(
                "fetch",
                vi.fn(async (url: string) => {
                    if (url === "/api/file/putFile") {
                        iconEntries.push({name: "acme__pkg.png", isDir: false});
                        return fakeResponse({json: {code: 0}});
                    }
                    return fakeResponse({contentType: "image/png", bytes: pngBytes()});
                }),
            );

            const action = createActionContext({
                featureId: "bazaar-custom-icon",
                config: {enabled: false},
                pluginName: PLUGIN,
            });
            const button = definition.settings[1] as Extract<SettingField, {kind: "button";}>;
            await button.onClick(action.context);
            await vi.waitFor(() => expect(rows()).toHaveLength(1));

            // 走管理窗口里的 base64 入口保存一张图
            document.querySelector<HTMLElement>("[data-action='base64']")?.click();
            const textarea = document.querySelector<HTMLTextAreaElement>("[data-text]")!;
            textarea.value = `data:image/png;base64,${btoa(String.fromCharCode(...pngBytes()))}`;
            document.querySelector<HTMLElement>("[data-confirm]")?.click();

            await vi.waitFor(() => expect(action.patches).toHaveLength(1));
            // 只写文件不打开功能的话，集市列表不会有任何变化（功能默认关闭）
            expect(action.patches[0]).toEqual({
                featureId: "bazaar-custom-icon",
                patch: {enabled: true},
            });
            expect(mockState.messages.at(-1)?.text).toBe("feature.bazaarCustomIcon.savedAndEnabled");
        });
    });

    describe("管理窗口", () => {
        it("五类已安装集市包都取一次，按类型与名称排序后逐行渲染", async () => {
            respond((api) => {
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {
                            packages: [
                                {author: "acme", name: "bravo", preferredName: "", iconURL: "b.png"},
                                {author: "acme", name: "alpha", preferredName: "Alpha", iconURL: "a.png"},
                                null,
                                {name: "no-author"},
                                {author: "acme", name: "invalid", invalidReason: "x"},
                            ],
                        },
                    };
                }
                if (api === "/api/bazaar/getInstalledTheme") {
                    return {code: 0, data: {packages: [{author: " acme ", name: " y ", preferredName: "Y"}]}};
                }
                return {code: 0, data: {packages: []}};
            });

            openIconManager(makeOptions());
            await vi.waitFor(() => expect(rows()).toHaveLength(3));

            // 五次集市接口 + 一次图标目录
            expect(mockState.fetchSyncPost).toHaveBeenCalledTimes(6);
            ["plugins", "themes", "icons", "templates", "widgets"].forEach((type) => {
                expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
                    `/api/bazaar/getInstalled${type.charAt(0).toUpperCase()}${type.slice(1, -1)}`,
                    {frontend: "desktop", keyword: ""},
                    undefined,
                    false,
                );
            });
            expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
                "/api/bazaar/getInstalledPlugin",
                {frontend: "desktop", keyword: ""},
                undefined,
                false,
            );
            // 插件排在主题前；同类按 label 排序；preferredName 缺省时退回包名
            expect(rows().map((row) => row.querySelector(".ss-bazaar-icon-manager__title")?.textContent))
                .toEqual(["Alpha", "bravo", "Y"]);
            // 作者与包名去空白后才写进 data-*，恢复原图标时靠它对上文件
            expect(rows()[2].dataset.owner).toBe("acme");
            expect(rows()[2].dataset.name).toBe("y");
        });

        it("前端类型原样带进内核请求（移动端拿到的已安装列表可能不同）", async () => {
            mockState.frontend = "mobile";
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(mockState.fetchSyncPost).toHaveBeenCalled());

            expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
                "/api/bazaar/getInstalledWidget",
                {frontend: "mobile", keyword: ""},
                undefined,
                false,
            );
        });

        it("已经有自定义图标的行：预览用 data URL，并多出一个「恢复」按钮", async () => {
            respond((api) => {
                if (api === "/api/file/readDir") {
                    return {code: 0, data: [{name: "acme__pkg.png", isDir: false}]};
                }
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({contentType: "image/png", bytes: pngBytes()})));

            openIconManager(makeOptions());
            await vi.waitFor(() => expect(rows()).toHaveLength(1));

            const row = rows()[0];
            expect(row.querySelector(".ss-bazaar-icon-manager__state")?.textContent).toBe(
                "feature.bazaarCustomIcon.customized",
            );
            expect(row.querySelector("[data-action='reset']")).not.toBeNull();
            expect(row.querySelector("img")?.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
        });

        it("读不出图标文件时退回集市包自带图标，窗口照样打得开", async () => {
            respond((api) => {
                if (api === "/api/file/readDir") {
                    return {code: 0, data: [{name: "acme__pkg.png", isDir: false}]};
                }
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ok: false, status: 500})));

            openIconManager(makeOptions());
            await vi.waitFor(() => expect(rows()).toHaveLength(1));

            // 一张坏图不该让整个窗口打不开，也不该把行变成空白
            expect(rows()[0].querySelector("img")?.getAttribute("src")).toBe("pkg.png");
        });

        it("拉列表失败时显示失败提示与重试按钮，重试成功后渲染列表", async () => {
            let failing = true;
            respond((api) => {
                if (api === "/api/bazaar/getInstalledPlugin" && failing) {
                    return {code: -1, msg: "denied"};
                }
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });

            openIconManager(makeOptions());
            await vi.waitFor(() => expect(document.body.textContent).toContain("feature.bazaarCustomIcon.failed"));
            // 失败要让人看见，不能静默成「列表是空的」
            expect(mockState.messages.some((message) => message.text.includes("bazaar-custom-icon.list")))
                .toBe(true);

            failing = false;
            document.querySelector<HTMLElement>("[data-retry]")?.click();
            await vi.waitFor(() => expect(rows()).toHaveLength(1));
        });

        it("一个包都没有时显示空提示", async () => {
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(document.body.textContent).toContain("feature.bazaarCustomIcon.empty"));
            expect(rows()).toHaveLength(0);
        });

        it("关闭按钮收掉窗口；再次打开只保留一个窗口", async () => {
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(document.body.textContent).toContain("feature.bazaarCustomIcon.empty"));

            document.querySelector<HTMLElement>("[data-close]")?.click();
            expect(document.querySelector(".ss-bazaar-icon-manager__list")).toBeNull();

            openIconManager(makeOptions());
            openIconManager(makeOptions());
            // 重复点动作行不该叠出好几个窗口
            expect(document.querySelectorAll(".ss-bazaar-icon-manager__list")).toHaveLength(1);
        });

        it("插件卸载时通过 onUnload 收掉窗口", async () => {
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(document.body.textContent).toContain("feature.bazaarCustomIcon.empty"));
            expect(unloads).toHaveLength(1);

            unloads[0]();

            expect(document.querySelector(".ss-bazaar-icon-manager__list")).toBeNull();
        });

        it("「选择图片」把当前行记成待写入目标并打开文件选择器", async () => {
            respond((api) => {
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(rows()).toHaveLength(1));
            // 文件选择框挂在弹窗容器上（不在列表里，列表每次保存都会整块重绘）
            const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
            const clickSpy = vi.spyOn(input, "click").mockImplementation(() => undefined);

            document.querySelector<HTMLElement>("[data-action='pick']")?.click();

            expect(clickSpy).toHaveBeenCalledTimes(1);
        });

        it("base64 贴错时提示并保留窗口，不写任何文件", async () => {
            respond((api) => {
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            const fetchMock = vi.fn(async () => fakeResponse());
            vi.stubGlobal("fetch", fetchMock);
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(rows()).toHaveLength(1));

            document.querySelector<HTMLElement>("[data-action='base64']")?.click();
            const textarea = document.querySelector<HTMLTextAreaElement>("[data-text]")!;
            textarea.value = "这不是 base64";
            document.querySelector<HTMLElement>("[data-confirm]")?.click();

            expect(mockState.messages.at(-1)?.text).toBe("feature.bazaarCustomIcon.invalid");
            // 用户还得能改，所以窗口不能跟着关掉
            expect(document.querySelector("[data-text]")).not.toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("保存成功但功能已经开着时只提示「已保存」，不重复落盘开关", async () => {
            const iconEntries: {name: string; isDir: boolean;}[] = [];
            respond((api) => {
                if (api === "/api/file/readDir") {
                    return {code: 0, data: iconEntries};
                }
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            vi.stubGlobal(
                "fetch",
                vi.fn(async (url: string) => {
                    if (url === "/api/file/putFile") {
                        iconEntries.push({name: "acme__pkg.png", isDir: false});
                        return fakeResponse({json: {code: 0}});
                    }
                    return fakeResponse({contentType: "image/png", bytes: pngBytes()});
                }),
            );
            const options = makeOptions({isEnabled: vi.fn(() => true)});
            openIconManager(options);
            await vi.waitFor(() => expect(rows()).toHaveLength(1));

            document.querySelector<HTMLElement>("[data-action='base64']")?.click();
            const textarea = document.querySelector<HTMLTextAreaElement>("[data-text]")!;
            textarea.value = `data:image/png;base64,${btoa(String.fromCharCode(...pngBytes()))}`;
            document.querySelector<HTMLElement>("[data-confirm]")?.click();

            await vi.waitFor(() => expect(mockState.messages.at(-1)?.text).toBe("feature.bazaarCustomIcon.saved"));
            expect(options.enable).not.toHaveBeenCalled();
            // 保存后要通知已挂载的功能重新读目录，否则集市列表一直是旧图
            expect(rows()[0].querySelector(".ss-bazaar-icon-manager__state")?.textContent)
                .toBe("feature.bazaarCustomIcon.customized");
        });

        it("「恢复」删掉该包的图标文件，并广播目录变化", async () => {
            const iconEntries: {name: string; isDir: boolean;}[] = [{name: "acme__pkg.png", isDir: false}];
            respond((api) => {
                if (api === "/api/file/readDir") {
                    return {code: 0, data: iconEntries};
                }
                if (api === "/api/file/removeFile") {
                    iconEntries.splice(0);
                    return {code: 0};
                }
                if (api === "/api/bazaar/getInstalledPlugin") {
                    return {
                        code: 0,
                        data: {packages: [{author: "acme", name: "pkg", preferredName: "Pkg", iconURL: "pkg.png"}]},
                    };
                }
                return {code: 0, data: {packages: []}};
            });
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({contentType: "image/png", bytes: pngBytes()})));
            const changed = vi.fn();
            document.addEventListener(ICON_CHANGED_EVENT, changed);
            openIconManager(makeOptions());
            await vi.waitFor(() => expect(rows()).toHaveLength(1));

            document.querySelector<HTMLElement>("[data-action='reset']")?.click();

            await vi.waitFor(() => expect(mockState.messages.at(-1)?.text).toBe("feature.bazaarCustomIcon.removed"));
            document.removeEventListener(ICON_CHANGED_EVENT, changed);
            expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
                "/api/file/removeFile",
                {path: `${ICON_DIR}/acme__pkg.png`},
                undefined,
                false,
            );
            expect(changed).toHaveBeenCalled();
            // 恢复后这一行不该还挂着「恢复」按钮
            expect(rows()[0].querySelector("[data-action='reset']")).toBeNull();
        });
    });

    describe("用户提供的图片来源（文件选择 / 粘贴）", () => {
        /** 只认文件头：后缀可以随便写，甚至没有后缀。 */
        it("选中的文件按文件头判定格式，不看后缀", async () => {
            const image = await imageFromFile(new File([pngBytes() as unknown as BlobPart], "whatever.txt"));
            expect(image.ext).toBe("png");
            // Blob 的 MIME 由扩展名给，内核偶尔会回 octet-stream，这里必须定死
            expect(image.blob.type).toBe("image/png");
        });

        it("不是图片的文件一律拒绝（改名的文本文件不算图）", async () => {
            await expect(imageFromFile(new File(["hello"], "a.png"))).rejects.toThrow(
                "the selected file is not a supported image",
            );
        });

        it("空文件与超过 4 MiB 的文件都拒绝：后者会拖垮同步", async () => {
            await expect(imageFromFile(new File([], "a.png"))).rejects.toThrow("the image file is empty");
            await expect(
                imageFromFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png")),
            ).rejects.toThrow("the image file is larger than 4 MiB");
        });

        it("直接粘贴 SVG 源码也收，但只有真的是 SVG 才收", () => {
            const svg = imageFromBase64('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
            expect(svg.ext).toBe("svg");
            expect(svg.blob.type).toBe("image/svg+xml");
            expect(() => imageFromBase64("<div>not an image</div>")).toThrow(
                "the pasted text is not an SVG image",
            );
        });

        it("urlencoded 的 data URI 走解码分支，解不开就明确报错", () => {
            const svg = imageFromBase64(
                "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
            );
            expect(svg.ext).toBe("svg");
            // 非法的百分号编码会让 decodeURIComponent 抛错，必须是「不是有效的 data URI」
            expect(() => imageFromBase64("data:image/svg+xml,%E0%A4%A")).toThrow(
                "the data URI is not valid",
            );
            // 解码后既不是已知文件头、MIME 也不认识
            expect(() => imageFromBase64("data:text/plain,hello")).toThrow(
                "the data URI is not a supported image",
            );
        });

        it("data URI 不完整、base64 内容非法、能解码但不是图片，分别给出对应错误", () => {
            expect(() => imageFromBase64("data:image/png;base64")).toThrow("the data URI is not complete");
            expect(() => imageFromBase64("!!!!not-base64!!!!")).toThrow("the base64 text is not valid");
            expect(() => imageFromBase64(btoa("hello"))).toThrow(
                "the base64 text does not hold a supported image",
            );
            expect(() => imageFromBase64("   ")).toThrow("the base64 text is empty");
        });

        it("MIME 能认出扩展名时按 MIME 兜底（文件头认不出 ico）", () => {
            const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
            const image = imageFromBase64(`data:image/x-icon;base64,${btoa(String.fromCharCode(...ico))}`);
            expect(image.ext).toBe("ico");
            expect(image.blob.type).toBe("image/x-icon");
        });
    });

    describe("mountBazaarCustomIcon：把图标贴回集市「已下载」列表", () => {
        const instances: {destroy?: () => void;}[] = [];
        let queue: FrameRequestCallback[] = [];

        /**
         * 每帧回调排在这里由测试驱动 —— `apply()` 的全部落点都在 rAF 里。
         *
         * 每一轮都要让出一个宏任务：图标文件是 `FileReader.readAsDataURL` 读成 data URL 的，
         * 那个回调排在宏任务里，只等微任务会在图还没读出来时就去断言。
         */
        const flushFrames = async (): Promise<void> => {
            for (let round = 0; round < 12; round++) {
                const callbacks = queue.splice(0);
                callbacks.forEach((callback) => callback(0));
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        };

        const mountApply = (pluginName = PLUGIN) => {
            queue = [];
            vi.spyOn(window, "requestAnimationFrame").mockImplementation(
                (callback: FrameRequestCallback): number => {
                    queue.push(callback);
                    return queue.length;
                },
            );
            vi.spyOn(window, "cancelAnimationFrame").mockImplementation((): void => undefined);
            const instance = mountBazaarCustomIcon(
                {plugin: {name: pluginName}} as unknown as Parameters<typeof mountBazaarCustomIcon>[0],
            );
            instances.push(instance);
            return instance;
        };

        /** 图标文件是按 `fetch("/api/file/getFile")` 读的（不走 fetchSyncPost）。 */
        const stubIconFetch = (init: FakeResponseInit = {}) => {
            const stub = vi.fn(async () => fakeResponse({contentType: "image/png", bytes: pngBytes(), ...init}));
            (globalThis as unknown as {fetch: unknown;}).fetch = stub;
            return stub;
        };

        /** 内核 `readDir` 的应答：只列出文件名，其余字段由功能自己过滤。 */
        const dirWith = (...names: string[]) => ({
            code: 0,
            data: names.map((name) => ({name, isDir: false})),
        });

        const cardMarkup = (name: string, options: {withImage?: boolean; src?: string;} = {}): string => {
            const slot = options.withImage === false ?
                // 单引号是 eslint 的 avoidEscape 允许的写法：里面本来就带双引号，转义反而更难读
                '<span class="b3-card__placeholder"></span>' :
                `<img src="${options.src ?? "assets/original.png"}">`;
            return `<div class="b3-card" data-name="${name}">
                <div class="b3-card__img">${slot}</div>
                <div class="b3-card__body">${name}</div>
            </div>`;
        };

        const mountPanel = (...cards: string[]): void => {
            document.body.innerHTML = `<div id="configBazaarDownloaded">${cards.join("")}</div>`;
        };

        const holderOf = (name: string): HTMLElement =>
            document.querySelector<HTMLElement>(`.b3-card[data-name="${name}"] .b3-card__img`) as HTMLElement;

        const imageOf = (name: string): HTMLImageElement | null => holderOf(name).querySelector("img");

        afterEach(() => {
            instances.splice(0).forEach((instance) => instance.destroy?.());
            queue = [];
        });

        it("给有图标槽的卡片贴上 data URL，并记下原文地址与版本号", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"));

            mountApply();
            await flushFrames();

            const holder = holderOf("pkg");
            const image = imageOf("pkg") as HTMLImageElement;
            // 内核没有托管 petal 目录的路由，只能把文件读成 data URL 塞进 src
            expect(image.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
            // 原文必须留一份：卸载 / 换图时要把卡片还原成内核给的那张
            expect(image.dataset.ssOriginal).toBe("assets/original.png");
            // 标记里带版本号，换图（文件名不变也一样）才会重新贴
            expect(holder.dataset.ssIcon).toBe("1:acme__pkg.png");
        });

        it("卡片没有对应图标时把原图恢复回去，不留我们的标记", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"));
            mountApply();
            await flushFrames();

            // 用户删掉图标：事件触发后重新读目录，这次一张都没有
            respond(() => dirWith());
            document.dispatchEvent(new Event(ICON_CHANGED_EVENT));
            await flushFrames();

            const holder = holderOf("pkg");
            const image = imageOf("pkg") as HTMLImageElement;
            expect(image.getAttribute("src")).toBe("assets/original.png");
            expect(image.dataset.ssOriginal).toBeUndefined();
            expect(holder.dataset.ssIcon).toBeUndefined();
        });

        it("本来没有图标的卡片补一张图，并把占位符收起来；还原时再放出来", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg", {withImage: false}));
            mountApply();
            await flushFrames();

            const holder = holderOf("pkg");
            const custom = holder.querySelector<HTMLImageElement>("img[data-ss-custom-icon='true']");
            expect(custom).not.toBeNull();
            expect(holder.querySelector("span")?.classList.contains("fn__none")).toBe(true);
            expect(holder.dataset.ssHidPlaceholder).toBe("true");
            // 自己造的那张图必须排在最前面，否则会被卡片的 flex 布局挤到文字后面
            expect(holder.firstElementChild).toBe(custom);

            respond(() => dirWith());
            document.dispatchEvent(new Event(ICON_CHANGED_EVENT));
            await flushFrames();

            expect(holder.querySelector("img[data-ss-custom-icon='true']")).toBeNull();
            expect(holder.querySelector("span")?.classList.contains("fn__none")).toBe(false);
            expect(holder.dataset.ssHidPlaceholder).toBeUndefined();
        });

        it("同一个图标只读一次：同一包里多张卡片复用同一个 data URL", async () => {
            const stub = stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"), cardMarkup("pkg"));
            mountApply();
            await flushFrames();

            expect(stub).toHaveBeenCalledTimes(1);
            const sources = Array.from(document.querySelectorAll(".b3-card__img img")).map((image) =>
                image.getAttribute("src")
            );
            expect(sources[0]).toBe(sources[1]);
        });

        it("集市整块重绘（innerHTML 被替换）之后重新贴上", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"));
            mountApply();
            await flushFrames();

            // 内核切换分类 / 排序时就是这么干的：卡片是全新的节点，标记全没了
            mountPanel(cardMarkup("pkg"));
            await flushFrames();

            expect(
                imageOf("pkg")?.getAttribute("src")?.startsWith("data:image/png;base64,"),
            ).toBe(true);
        });

        it("换掉同名图标文件后按新版本重新贴（文件名不变，版本号变）", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"));
            mountApply();
            await flushFrames();
            expect(holderOf("pkg").dataset.ssIcon).toBe("1:acme__pkg.png");

            stubIconFetch({contentType: "image/svg+xml", bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67])});
            respond(() => dirWith("acme__pkg.svg"));
            document.dispatchEvent(new Event(ICON_CHANGED_EVENT));
            await flushFrames();

            expect(holderOf("pkg").dataset.ssIcon).toBe("2:acme__pkg.svg");
            expect(imageOf("pkg")?.getAttribute("src")?.startsWith("data:image/svg+xml;base64,")).toBe(true);
        });

        it("读不出某一张图时只跳过它，其它卡片照常贴", async () => {
            let call = 0;
            const stub = vi.fn(async () => {
                call += 1;
                // 第一张坏掉，第二张正常
                return call === 1 ? fakeResponse({ok: false, status: 500}) : fakeResponse({bytes: pngBytes()});
            });
            (globalThis as unknown as {fetch: unknown;}).fetch = stub;
            respond(() => dirWith("bad__one.png", "good__two.png"));
            mountPanel(cardMarkup("one"), cardMarkup("two"));

            mountApply();
            await flushFrames();

            expect(imageOf("one")?.getAttribute("src")).toBe("assets/original.png");
            expect(imageOf("one")?.dataset.ssOriginal).toBeUndefined();
            expect(imageOf("two")?.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
        });

        it("图标目录读不到（code≠0）时保留上一次贴好的图标，不把界面清空", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"));
            mountApply();
            await flushFrames();
            const applied = imageOf("pkg")?.getAttribute("src");

            respond(() => {
                throw new Error("kernel says no");
            });
            document.dispatchEvent(new Event(ICON_CHANGED_EVENT));
            await flushFrames();

            expect(imageOf("pkg")?.getAttribute("src")).toBe(applied);
            expect(holderOf("pkg").dataset.ssIcon).toBe("1:acme__pkg.png");
        });

        it("图还没读完卡片就被移出文档时，旧结果不许再贴回去", async () => {
            let release: (() => void) | undefined;
            const stub = vi.fn(() =>
                new Promise((resolve) => {
                    release = () => resolve(fakeResponse({bytes: pngBytes()}));
                })
            );
            (globalThis as unknown as {fetch: unknown;}).fetch = stub;
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"));
            const image = imageOf("pkg") as HTMLImageElement;
            mountApply();
            await flushFrames();

            // 集市在这一瞬间重绘：原来的卡片与它的槽都已经不在文档里
            document.body.innerHTML = '<div id="configBazaarDownloaded"></div>';
            release?.();
            await flushFrames();

            expect(image.getAttribute("src")).toBe("assets/original.png");
        });

        it("「已下载」容器还没出现时什么都不做，出现之后再贴上", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            document.body.innerHTML = "<div class='b3-dialog'></div>";

            mountApply();
            await flushFrames();
            expect(document.querySelector("img[data-ss-custom-icon='true']")).toBeNull();

            // 宿主的设置弹窗里把集市面板建出来（弹窗内的突变才会触发重扫）
            document.querySelector(".b3-dialog")?.append(
                Object.assign(document.createElement("div"), {
                    id: "configBazaarDownloaded",
                    innerHTML: cardMarkup("pkg"),
                }),
            );
            await flushFrames();
            await flushFrames();

            expect(imageOf("pkg")?.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
        });

        it("卸载：还原所有贴过图的卡片、停掉观察器，且可以重复调用", async () => {
            stubIconFetch();
            respond(() => dirWith("acme__pkg.png"));
            mountPanel(cardMarkup("pkg"), cardMarkup("pkg", {withImage: false}));
            const instance = mountApply();
            await flushFrames();

            expect(imageOf("pkg")?.dataset.ssOriginal).toBe("assets/original.png");

            expect(() => instance.destroy?.()).not.toThrow();
            expect(() => instance.destroy?.()).not.toThrow();

            // 有图的还原原文，没图的把占位符放回来
            const plain = document.querySelector<HTMLElement>(".b3-card[data-name='pkg'] .b3-card__img img");
            expect(plain?.getAttribute("src")).toBe("assets/original.png");
            expect(document.querySelector("img[data-ss-custom-icon='true']")).toBeNull();
            expect(holderOf("pkg").dataset.ssIcon).toBeUndefined();

            // 观察器已断开：再重绘也不会重新贴
            mountPanel(cardMarkup("pkg"));
            await flushFrames();
            expect(imageOf("pkg")?.getAttribute("src")).toBe("assets/original.png");
        });
    });
});
