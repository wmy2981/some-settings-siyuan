// @vitest-environment node
/**
 * `core/config.ts`：配置归一化、持久化、导出 / 导入 / 清除。
 *
 * 这一层的失败模式都很安静（写没写进去、读回对不对、问题有没有报出来），
 * 所以每个动作都要同时断言「磁盘上变成了什么」和「用户会不会看到问题」。
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
import {
    attachProblems,
    ConfigStore,
    defaultConfig,
    describeMismatch,
    normalizeConfig,
    sameConfig,
    storageNameOf,
} from "../../src/core/config";
import {setDetailedLogging} from "../../src/core/log";
import type {
    FeatureDefinition,
    SettingField,
} from "../../src/core/types";
import {mockState} from "../mocks/siyuan";

const PLUGIN_NAME = "some-settings-siyuan";

beforeEach(() => {
    // 这份测试要观察控制台上的告警，详细日志默认关着，所以显式打开
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});

/** 一个把「磁盘」放在 Map 里的宿主播件，行为与 plugin.loadData / saveData 一致。 */
class FakeHost {
    readonly name = PLUGIN_NAME;
    readonly files = new Map<string, unknown>();
    /** 让写盘被内核拒绝的开关（模拟 readonly 工作空间）。 */
    rejectWrites = false;
    /** 让写盘成功但读回的内容不对（模拟 saveData 提前 resolve）。 */
    corruptWrites = false;

    loadData = vi.fn(async (name: string): Promise<unknown> =>
        this.files.has(name) ? JSON.parse(JSON.stringify(this.files.get(name))) : ""
    );

    saveData = vi.fn(async (name: string, value: unknown): Promise<unknown> => {
        if (this.rejectWrites) {
            return {code: 1, msg: "readonly"};
        }
        this.files.set(
            name,
            this.corruptWrites ? {...(value as object), enabled: "corrupted"} : JSON.parse(
                JSON.stringify(value),
            ),
        );
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

/** 让 `listStoredFiles()` 看到宿主 Map 里的文件。 */
const serveDirListing = (host: FakeHost): void => {
    mockState.fetchSyncPost.mockImplementation(async (path: unknown) => {
        if (path !== "/api/file/readDir") {
            return {code: 0};
        }
        return {
            code: 0,
            data: [...host.files.keys()].map((name) => ({name, isDir: false})),
        };
    });
};

const settings: SettingField[] = [
    {kind: "switch", key: "enabled", title: "s.enabled", default: false},
    {kind: "text", key: "label", title: "s.label", default: "hi"},
    {kind: "number", key: "size", title: "s.size", default: 12, min: 8, max: 24},
    {
        kind: "select",
        key: "mode",
        title: "s.mode",
        default: "auto",
        options: [{value: "auto", label: "s.auto"}, {value: "manual", label: "s.manual"}],
    },
    {kind: "note", key: "about", text: "s.about"},
    {kind: "button", key: "run", title: "s.run", label: "s.runLabel", onClick: () => undefined},
];

const definitionOf = (id: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
    id,
    category: "editor",
    name: `${id}.name`,
    enabled: true,
    settings,
    ...extra,
});

describe("storageNameOf", () => {
    it("一个功能一个文件名", () => {
        expect(storageNameOf("modal-blur")).toBe("feature-modal-blur");
    });
});

describe("attachProblems", () => {
    it("把问题清单拼成消息并挂在 error 上", () => {
        const error = attachProblems(["a: bad", "b: worse"]);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("a: bad; b: worse");
        expect(error.problems).toEqual(["a: bad", "b: worse"]);
    });
});

describe("describeMismatch", () => {
    it("一致时返回空串", () => {
        expect(describeMismatch({enabled: true, label: "x"}, {enabled: true, label: "x"})).toBe("");
    });

    it("只比较写入时用到的键，宿主额外字段不算差异", () => {
        expect(describeMismatch({enabled: true}, {enabled: true, extra: 1})).toBe("");
    });

    it("值不同时给出两边的实际内容", () => {
        expect(describeMismatch({enabled: true}, {enabled: false})).toBe(
            "enabled: wrote true / read back false",
        );
    });

    it("嵌套值按 JSON 比较，不是按引用比较", () => {
        expect(describeMismatch({list: [1, {a: 2}]}, {list: [1, {a: 2}]})).toBe("");
        expect(describeMismatch({list: [1, {a: 2}]}, {list: [1, {a: 3}]})).toBe(
            'list: wrote [1,{"a":2}] / read back [1,{"a":3}]',
        );
    });

    it("读回的不是对象时报同一个问题", () => {
        expect(describeMismatch({}, null)).toBe("read back is not an object (null)");
        expect(describeMismatch({}, [])).toBe("read back is not an object ([])");
        expect(describeMismatch({}, "text")).toBe('read back is not an object ("text")');
    });
});

describe("normalizeConfig", () => {
    it("输入不是对象时全部回落默认值", () => {
        expect(normalizeConfig(settings, null)).toEqual({
            enabled: false,
            label: "hi",
            size: 12,
            mode: "auto",
        });
        expect(normalizeConfig(settings, "text").label).toBe("hi");
        expect(normalizeConfig(settings, []).enabled).toBe(false);
    });

    it("缺字段时用默认值，多出来的字段被丢掉", () => {
        const config = normalizeConfig(settings, {enabled: true, unknown: "x"});
        expect(config).toEqual({enabled: true, label: "hi", size: 12, mode: "auto"});
        expect(config).not.toHaveProperty("unknown");
    });

    it("说明块与动作行不参与配置", () => {
        const config = normalizeConfig(settings, {about: "x", run: true});
        expect(config).not.toHaveProperty("about");
        expect(config).not.toHaveProperty("run");
    });

    it("类型不符的字段回落默认值并给出警告", () => {
        const warnings: string[] = [];
        const config = normalizeConfig(
            settings,
            {enabled: "yes", label: 5, size: "12", mode: "nope"},
            (message) => warnings.push(message),
        );
        expect(config).toEqual({enabled: false, label: "hi", size: 12, mode: "auto"});
        expect(warnings).toHaveLength(4);
        expect(warnings[0]).toBe('"enabled" should be boolean, got "yes", falling back to the default');
        expect(warnings[1]).toBe('"label" should be string, got 5, falling back to the default');
        expect(warnings[2]).toBe('"size" should be number, got "12", falling back to the default');
        expect(warnings[3]).toBe('"mode" should be one of auto/manual, got "nope", falling back to the default');
    });

    it("数字按 min / max 夹取", () => {
        expect(normalizeConfig(settings, {size: 4}).size).toBe(8);
        expect(normalizeConfig(settings, {size: 99}).size).toBe(24);
        expect(normalizeConfig(settings, {size: 10}).size).toBe(10);
    });

    it("非有限数字（NaN / Infinity）回落默认值", () => {
        expect(normalizeConfig(settings, {size: Number.NaN}).size).toBe(12);
        expect(normalizeConfig(settings, {size: Number.POSITIVE_INFINITY}).size).toBe(12);
    });

    it("下拉按白名单校验", () => {
        expect(normalizeConfig(settings, {mode: "manual"}).mode).toBe("manual");
        expect(normalizeConfig(settings, {mode: "other"}).mode).toBe("auto");
    });

    it("只有 optionsProvider 的下拉不做白名单校验", () => {
        const fields: SettingField[] = [{
            kind: "select",
            key: "notebook",
            title: "s.notebook",
            default: "",
            optionsProvider: () => [{value: "a", label: "A"}],
        }];
        expect(normalizeConfig(fields, {notebook: "外部值"}).notebook).toBe("外部值");
        expect(normalizeConfig(fields, {notebook: 1}).notebook).toBe("");
    });

    it("开关接受 false，不会被当成缺值", () => {
        expect(normalizeConfig(settings, {enabled: false}).enabled).toBe(false);
    });

    it("未知的控件类型既不写入也不报错", () => {
        const fields = [{kind: "mystery", key: "x", title: "x"} as unknown as SettingField];
        expect(normalizeConfig(fields, {x: 1})).toEqual({});
    });

    it("只有 optionsProvider 的下拉收到非法值时，警告里没有白名单可列", () => {
        const warnings: string[] = [];
        const fields: SettingField[] = [{
            kind: "select",
            key: "notebook",
            title: "s.notebook",
            default: "a",
            optionsProvider: () => [{value: "a", label: "A"}],
        }];
        normalizeConfig(fields, {notebook: 3}, (message) => warnings.push(message));
        expect(warnings[0]).toBe(String.raw`"notebook" should be one of , got 3, falling back to the default`);
    });

    it("空字符串是合法文本", () => {
        expect(normalizeConfig(settings, {label: ""}).label).toBe("");
    });
});

describe("sameConfig", () => {
    it("键与值都相同时为真，顺序无关", () => {
        expect(sameConfig({enabled: true, size: 12}, {size: 12, enabled: true})).toBe(true);
    });

    it("少一个键或多一个键都算不同", () => {
        expect(sameConfig({enabled: true}, {enabled: true, size: 12})).toBe(false);
        expect(sameConfig({enabled: true, size: 12}, {enabled: true})).toBe(false);
    });

    it("嵌套值按 JSON 比较", () => {
        expect(sameConfig({list: [1, {a: 2}]}, {list: [1, {a: 2}]})).toBe(true);
        expect(sameConfig({list: [1, {a: 2}]}, {list: [1, {a: 3}]})).toBe(false);
    });
});

describe("defaultConfig", () => {
    it("只取 schema 默认值，不读盘", () => {
        expect(defaultConfig(settings)).toEqual({enabled: false, label: "hi", size: 12, mode: "auto"});
    });
});

describe("ConfigStore.register / get / definitionOf", () => {
    it("没有配置文件时用默认值", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const config = await store.register(definitionOf("alpha"));
        expect(config.enabled).toBe(false);
        expect(store.get("alpha")).toEqual(config);
        expect(store.definitionOf("alpha")?.id).toBe("alpha");
        expect(host.loadData).toHaveBeenCalledWith("feature-alpha");
    });

    it("读回已有配置并与默认值合并", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "stored"});
        const store = new ConfigStore(host.asPlugin());
        const config = await store.register(definitionOf("alpha"));
        expect(config).toEqual({enabled: true, label: "stored", size: 12, mode: "auto"});
    });

    it("宿主兑现空串（文件不存在）时按没有配置处理", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        host.loadData.mockResolvedValueOnce("");
        const config = await store.register(definitionOf("alpha"));
        expect(config.enabled).toBe(false);
    });

    it("读盘失败时回落默认值，不阻塞注册", async () => {
        const host = new FakeHost();
        host.loadData.mockRejectedValueOnce(new Error("io error"));
        const store = new ConfigStore(host.asPlugin());
        await expect(store.register(definitionOf("alpha"))).resolves.toEqual(
            {enabled: false, label: "hi", size: 12, mode: "auto"},
        );
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });

    it("配置文件里有坏字段时回落默认值并告警", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: "yes", size: 999});
        const store = new ConfigStore(host.asPlugin());
        const config = await store.register(definitionOf("alpha"));
        expect(config.enabled).toBe(false);
        expect(config.size).toBe(24);
        expect(vi.mocked(console.warn).mock.calls.some((call) => String(call[0]).includes("field problem"))).toBe(true);
    });

    it("没有注册过的 id 返回空对象", () => {
        const store = new ConfigStore(new FakeHost().asPlugin());
        expect(store.get("nope")).toEqual({});
        expect(store.definitionOf("nope")).toBeUndefined();
    });
});

describe("ConfigStore 订阅", () => {
    it("patch 之后通知订阅者，取消订阅后不再通知", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        const unsubscribe = store.subscribe("alpha", listener);
        await store.patch("alpha", {enabled: true});
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        await store.patch("alpha", {enabled: false});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("只通知改动的那一个功能", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.register(definitionOf("beta"));
        const alpha = vi.fn();
        const beta = vi.fn();
        store.subscribe("alpha", alpha);
        store.subscribe("beta", beta);
        await store.patch("alpha", {enabled: true});
        expect(alpha).toHaveBeenCalledTimes(1);
        expect(beta).not.toHaveBeenCalled();
    });

    it("dispose 之后不再通知", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        store.subscribe("alpha", listener);
        store.dispose();
        await store.patch("alpha", {enabled: true});
        expect(listener).not.toHaveBeenCalled();
    });
});

describe("ConfigStore.patch", () => {
    it("patch 合并后写盘并按 schema 归一化", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.patch("alpha", {label: "new"});
        expect(store.get("alpha").label).toBe("new");
        expect(host.files.get("feature-alpha")).toEqual({enabled: false, label: "new", size: 12, mode: "auto"});
    });

    it("patch 只写这一个功能的文件", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.register(definitionOf("beta"));
        host.saveData.mockClear();
        await store.patch("alpha", {enabled: true});
        expect(host.saveData).toHaveBeenCalledTimes(1);
        expect(host.saveData).toHaveBeenCalledWith("feature-alpha", expect.any(Object));
    });

    it("patch 里不合法的值会回落默认值并告警", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.patch("alpha", {size: "big"});
        expect(store.get("alpha").size).toBe(12);
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });

    it("与磁盘相同的值不重复写盘", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.files.set("feature-alpha", {enabled: false, label: "hi", size: 12, mode: "auto"});
        host.saveData.mockClear();
        await store.patch("alpha", {enabled: false});
        await store.patch("alpha", {label: "hi"});
        expect(host.saveData).not.toHaveBeenCalled();
    });

    it("写盘成功后立刻通知订阅者，不必等应用重载", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        store.subscribe("alpha", listener);
        await store.patch("alpha", {enabled: true});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("写盘失败时抛出，并把内存态退回改动之前", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.files.set("feature-alpha", {enabled: false, label: "keep", size: 12, mode: "auto"});
        await store.register(definitionOf("alpha"));
        host.saveData.mockRejectedValueOnce(new Error("disk full"));
        await expect(store.patch("alpha", {label: "changed"})).rejects.toThrow("disk full");
        expect(store.get("alpha").label).toBe("keep");
    });

    it("内核拒绝写入时抛出带问题的错误，内存态同样回退", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.rejectWrites = true;
        await expect(store.patch("alpha", {enabled: true})).rejects.toMatchObject({
            problems: ["feature-alpha: code 1: readonly"],
        });
        expect(store.get("alpha").enabled).toBe(false);
    });

    it("写后读回不一致时抛出，并把内存态退回改动之前", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.corruptWrites = true;
        const error = await store.patch("alpha", {enabled: true}).catch((reason: unknown) => reason);
        expect(error).toMatchObject({
            problems: ['feature-alpha：enabled: wrote true / read back "corrupted"'],
        });
        expect(store.get("alpha").enabled).toBe(false);
    });

    it("同一功能的写入按调用顺序执行，旧写入不能覆盖新配置", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        let releaseFirstWrite: (() => void) | undefined;
        const firstWrite = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        host.saveData.mockImplementationOnce(async (name: string, value: unknown): Promise<unknown> => {
            await firstWrite;
            host.files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });
        const first = store.patch("alpha", {enabled: true});
        const second = store.patch("alpha", {enabled: false});
        await Promise.resolve();
        await Promise.resolve();
        expect(host.saveData).toHaveBeenCalledTimes(1);
        releaseFirstWrite?.();
        await first;
        await second;
        expect(host.saveData).toHaveBeenCalledTimes(2);
        expect(host.files.get("feature-alpha")).toMatchObject({enabled: false});
    });

    it("前一次写入失败不阻断后续写入，也不回滚后续配置", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        let rejectFirstWrite: (() => void) | undefined;
        const firstWrite = new Promise<void>((_, reject) => {
            rejectFirstWrite = () => reject(new Error("disk full"));
        });
        host.saveData.mockReturnValueOnce(firstWrite);
        const first = store.patch("alpha", {enabled: true});
        const second = store.patch("alpha", {label: "latest"});
        rejectFirstWrite?.();
        await expect(first).rejects.toThrow("disk full");
        await expect(second).resolves.toBeUndefined();
        expect(store.get("alpha")).toMatchObject({enabled: false, label: "latest"});
        expect(host.files.get("feature-alpha")).toMatchObject({enabled: false, label: "latest"});
    });

    it("没有注册过的 id 上的 patch 什么也不做", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await expect(store.patch("ghost", {enabled: true})).resolves.toBeUndefined();
        expect(host.saveData).not.toHaveBeenCalled();
    });
});

describe("ConfigStore.clearAll", () => {
    it("删掉目录里的每个配置文件，并把内存态回落默认值", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "x", size: 16, mode: "auto"});
        host.files.set("feature-gone", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        store.subscribe("alpha", listener);

        await store.clearAll();

        expect(host.files.size).toBe(0);
        expect(store.get("alpha")).toEqual({enabled: false, label: "hi", size: 12, mode: "auto"});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("历史上带 .json 扩展名的配置文件也认", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha.json", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.clearAll();
        expect(host.files.size).toBe(0);
    });

    it("已经不在代码里的功能留下的配置文件照样被删掉", async () => {
        const host = new FakeHost();
        host.files.set("feature-retired", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.clearAll();
        expect(host.files.size).toBe(0);
    });

    it("名字不合规的文件不碰，只告警", async () => {
        const host = new FakeHost();
        host.files.set("notes.txt", "keep me");
        host.files.set("feature-alpha", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.clearAll();
        expect([...host.files.keys()]).toEqual(["notes.txt"]);
    });

    it("有文件删不掉时抛出，并列出全部失败项", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        host.files.set("feature-beta", {enabled: true});
        serveDirListing(host);
        host.removeData.mockResolvedValue({code: 500, msg: "io error"});
        const store = new ConfigStore(host.asPlugin());
        await expect(store.clearAll()).rejects.toMatchObject({
            problems: [
                "feature-alpha: code 500: io error",
                "feature-beta: code 500: io error",
            ],
        });
    });

    it("列不出目录时抛出，绝不假装已经清干净", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: -1, msg: "kernel busy"});
        const store = new ConfigStore(new FakeHost().asPlugin());
        await expect(store.clearAll()).rejects.toThrow("cannot list");
    });
});

describe("ConfigStore.exportAll", () => {
    it("按目录里的文件导出，键是功能 id", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "a"});
        host.files.set("feature-retired", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await expect(store.exportAll()).resolves.toEqual({
            alpha: {enabled: true, label: "a"},
            retired: {enabled: true},
        });
    });

    it("文件里不是对象时跳过它", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", "not an object");
        host.files.set("feature-beta", [1, 2]);
        host.files.set("feature-gamma", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await expect(store.exportAll()).resolves.toEqual({gamma: {enabled: true}});
    });

    it("读不到的文件不进导出结果", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        serveDirListing(host);
        host.loadData.mockRejectedValueOnce(new Error("io error"));
        const store = new ConfigStore(host.asPlugin());
        await expect(store.exportAll()).resolves.toEqual({});
    });

    it("列不出目录时抛出", async () => {
        mockState.fetchSyncPost.mockRejectedValue(new Error("offline"));
        const store = new ConfigStore(new FakeHost().asPlugin());
        await expect(store.exportAll()).rejects.toThrow("offline");
    });
});

describe("ConfigStore.importMany", () => {
    it("认识的 id 按 schema 归一化后写入", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const result = await store.importMany({alpha: {enabled: true, size: 999}});
        expect(result).toEqual({applied: ["alpha"], skipped: []});
        expect(host.files.get("feature-alpha")).toEqual({enabled: true, label: "hi", size: 24, mode: "auto"});
        expect(store.get("alpha").size).toBe(24);
    });

    it("导入后立刻通知订阅者，不必等页面重载", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        store.subscribe("alpha", listener);
        await store.importMany({alpha: {enabled: true}});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("不认识的 id 原样写回自己的文件", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const result = await store.importMany({retired: {anything: [1, 2]}});
        expect(result).toEqual({applied: ["retired"], skipped: []});
        expect(host.files.get("feature-retired")).toEqual({anything: [1, 2]});
    });

    it("注册表里有、但本宿主不加载的功能同样按它的 schema 校验", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        // mobile-console-log 在注册表里；这里没有 register 它，模拟「本宿主不加载」
        await expect(store.importMany({"mobile-console-log": {enabled: "yes"}})).rejects.toMatchObject({
            problems: [expect.stringContaining('mobile-console-log: "enabled" should be boolean')],
        });
    });

    it("注册表里有、本宿主没注册的功能导入后不会凭空造出内存态", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const result = await store.importMany({"mobile-console-log": {enabled: true}});
        expect(result).toEqual({applied: ["mobile-console-log"], skipped: []});
        expect(host.files.get("feature-mobile-console-log")).toMatchObject({enabled: true});
        // 没有注册就没有内存态，下次真正加载时再从磁盘读
        expect(store.get("mobile-console-log")).toEqual({});
    });

    it("id 不合规或值不是对象的条目一律不写，交回调用方汇报", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const result = await store.importMany({
            "../escape": {enabled: true},
            "Bad Id": {enabled: true},
            empty: null,
            list: [1, 2],
        });
        expect(result).toEqual({applied: [], skipped: ["../escape", "Bad Id", "empty", "list"]});
        expect(host.saveData).not.toHaveBeenCalled();
    });

    it("认识的 id 有坏字段时整体不写", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await expect(store.importMany({alpha: {enabled: 1}, retired: {enabled: true}})).rejects.toMatchObject({
            problems: [expect.stringContaining('alpha: "enabled" should be boolean')],
        });
        expect(host.files.size).toBe(0);
    });

    it("写盘失败时抛出带问题的错误", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.rejectWrites = true;
        await expect(store.importMany({alpha: {enabled: true}})).rejects.toMatchObject({
            problems: ["feature-alpha: code 1: readonly"],
        });
    });
});

describe("prefetch", () => {
    it("并发读回配置文件，register 之后不再重复读盘", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "已存"});
        host.files.set("feature-beta", {enabled: false});
        let running = 0;
        let peak = 0;
        const original = host.loadData.getMockImplementation() as (name: string) => Promise<unknown>;
        host.loadData.mockImplementation(async (name: string): Promise<unknown> => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 2));
            try {
                return await original(name);
            } finally {
                running -= 1;
            }
        });

        const store = new ConfigStore(host.asPlugin());
        await store.prefetch([definitionOf("alpha"), definitionOf("beta")]);
        // 两次读盘是同时在跑，不是一次等一次
        expect(peak).toBe(2);
        const reads = host.loadData.mock.calls.length;

        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: true, label: "已存"});
        await expect(store.register(definitionOf("beta"))).resolves.toMatchObject({enabled: false});
        // 预读过的文件不再读第二次
        expect(host.loadData.mock.calls.length).toBe(reads);
    });

    it("预读失败的功能回落默认值并记一条告警", async () => {
        const host = new FakeHost();
        host.loadData.mockRejectedValueOnce(new Error("offline"));
        const store = new ConfigStore(host.asPlugin());
        await store.prefetch([definitionOf("alpha")]);

        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: false, label: "hi"});
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });

    it("某个文件读得慢只影响它自己的 register", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        host.files.set("feature-beta", {enabled: true});
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const original = host.loadData.getMockImplementation() as (name: string) => Promise<unknown>;
        host.loadData.mockImplementation(async (name: string): Promise<unknown> => {
            if (name === "feature-alpha") {
                await gate;
            }
            return original(name);
        });

        const store = new ConfigStore(host.asPlugin());
        await store.prefetch([definitionOf("alpha"), definitionOf("beta")]);
        // alpha 的读盘还悬着，beta 照常拿到自己的配置
        await expect(store.register(definitionOf("beta"))).resolves.toMatchObject({enabled: true});

        let resolved = false;
        const alpha = store.register(definitionOf("alpha")).then(() => {
            resolved = true;
        });
        await new Promise((done) => setTimeout(done, 5));
        expect(resolved).toBe(false);
        release();
        await alpha;
        expect(resolved).toBe(true);
    });

    it("没有预读过的功能仍然现场读盘", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        const store = new ConfigStore(host.asPlugin());
        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: true});
        expect(host.loadData).toHaveBeenCalledWith("feature-alpha");
    });

    it("预读结果读完即用，不留在内存里覆盖之后的改动", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        const store = new ConfigStore(host.asPlugin());
        await store.prefetch([definitionOf("alpha")]);
        await store.register(definitionOf("alpha"));
        // 第二次注册（例如设置面板重建）必须重新读盘，拿到的是最新值
        host.files.set("feature-alpha", {enabled: false, label: "新值"});
        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: false, label: "新值"});
    });
});
