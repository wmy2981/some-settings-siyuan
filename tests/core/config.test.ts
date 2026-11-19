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
    it("one file per feature", () => {
        expect(storageNameOf("modal-blur")).toBe("feature-modal-blur");
    });
});

describe("attachProblems", () => {
    it("joins the problem list into a message and attaches it to the error", () => {
        const error = attachProblems(["a: bad", "b: worse"]);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("a: bad; b: worse");
        expect(error.problems).toEqual(["a: bad", "b: worse"]);
    });
});

describe("describeMismatch", () => {
    it("returns an empty string when they match", () => {
        expect(describeMismatch({enabled: true, label: "x"}, {enabled: true, label: "x"})).toBe("");
    });

    it("compares only the keys that were written; extra host fields are not a difference", () => {
        expect(describeMismatch({enabled: true}, {enabled: true, extra: 1})).toBe("");
    });

    it("reports the actual content on both sides when the values differ", () => {
        expect(describeMismatch({enabled: true}, {enabled: false})).toBe(
            "enabled: wrote true / read back false",
        );
    });

    it("compares nested values by JSON, not by reference", () => {
        expect(describeMismatch({list: [1, {a: 2}]}, {list: [1, {a: 2}]})).toBe("");
        expect(describeMismatch({list: [1, {a: 2}]}, {list: [1, {a: 3}]})).toBe(
            'list: wrote [1,{"a":2}] / read back [1,{"a":3}]',
        );
    });

    it("reports the same problem when the read-back value is not an object", () => {
        expect(describeMismatch({}, null)).toBe("read back is not an object (null)");
        expect(describeMismatch({}, [])).toBe("read back is not an object ([])");
        expect(describeMismatch({}, "text")).toBe('read back is not an object ("text")');
    });
});

describe("normalizeConfig", () => {
    it("falls back to the defaults entirely when the input is not an object", () => {
        expect(normalizeConfig(settings, null)).toEqual({
            enabled: false,
            label: "hi",
            size: 12,
            mode: "auto",
        });
        expect(normalizeConfig(settings, "text").label).toBe("hi");
        expect(normalizeConfig(settings, []).enabled).toBe(false);
    });

    it("missing fields use the default and extra fields are dropped", () => {
        const config = normalizeConfig(settings, {enabled: true, unknown: "x"});
        expect(config).toEqual({enabled: true, label: "hi", size: 12, mode: "auto"});
        expect(config).not.toHaveProperty("unknown");
    });

    it("note blocks and action rows are not part of the config", () => {
        const config = normalizeConfig(settings, {about: "x", run: true});
        expect(config).not.toHaveProperty("about");
        expect(config).not.toHaveProperty("run");
    });

    it("fields of the wrong type fall back to the default with a warning", () => {
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

    it("numbers are clamped to min / max", () => {
        expect(normalizeConfig(settings, {size: 4}).size).toBe(8);
        expect(normalizeConfig(settings, {size: 99}).size).toBe(24);
        expect(normalizeConfig(settings, {size: 10}).size).toBe(10);
    });

    it("non-finite numbers (NaN / Infinity) fall back to the default", () => {
        expect(normalizeConfig(settings, {size: Number.NaN}).size).toBe(12);
        expect(normalizeConfig(settings, {size: Number.POSITIVE_INFINITY}).size).toBe(12);
    });

    it("select values are validated against the whitelist", () => {
        expect(normalizeConfig(settings, {mode: "manual"}).mode).toBe("manual");
        expect(normalizeConfig(settings, {mode: "other"}).mode).toBe("auto");
    });

    it("selects with only an optionsProvider skip the whitelist check", () => {
        const fields: SettingField[] = [{
            kind: "select",
            key: "notebook",
            title: "s.notebook",
            default: "",
            optionsProvider: () => [{value: "a", label: "A"}],
        }];
        expect(normalizeConfig(fields, {notebook: "external value"}).notebook).toBe("external value");
        expect(normalizeConfig(fields, {notebook: 1}).notebook).toBe("");
    });

    it("a switch accepts false and does not treat it as missing", () => {
        expect(normalizeConfig(settings, {enabled: false}).enabled).toBe(false);
    });

    it("unknown control kinds are neither written nor reported", () => {
        const fields = [{kind: "mystery", key: "x", title: "x"} as unknown as SettingField];
        expect(normalizeConfig(fields, {x: 1})).toEqual({});
    });

    it("when a select with only an optionsProvider gets an invalid value, the warning has no whitelist to list", () => {
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

    it("an empty string is valid text", () => {
        expect(normalizeConfig(settings, {label: ""}).label).toBe("");
    });

    it("multiline and single-line text share one validation: store the string, fall back on a type mismatch", () => {
        const fields: SettingField[] = [{kind: "textarea", key: "authors", title: "s.authors", default: ""}];
        expect(normalizeConfig(fields, {authors: "a\nb"}).authors).toBe("a\nb");
        expect(normalizeConfig(fields, {authors: ""}).authors).toBe("");
        const warnings: string[] = [];
        expect(normalizeConfig(fields, {authors: 3}, (message) => warnings.push(message)).authors).toBe("");
        expect(warnings[0]).toBe('"authors" should be string, got 3, falling back to the default');
    });
});

describe("sameConfig", () => {
    it("true when keys and values match, regardless of order", () => {
        expect(sameConfig({enabled: true, size: 12}, {size: 12, enabled: true})).toBe(true);
    });

    it("one missing or extra key already counts as different", () => {
        expect(sameConfig({enabled: true}, {enabled: true, size: 12})).toBe(false);
        expect(sameConfig({enabled: true, size: 12}, {enabled: true})).toBe(false);
    });

    it("nested values are compared by JSON", () => {
        expect(sameConfig({list: [1, {a: 2}]}, {list: [1, {a: 2}]})).toBe(true);
        expect(sameConfig({list: [1, {a: 2}]}, {list: [1, {a: 3}]})).toBe(false);
    });
});

describe("defaultConfig", () => {
    it("uses only the schema defaults and does not touch the disk", () => {
        expect(defaultConfig(settings)).toEqual({enabled: false, label: "hi", size: 12, mode: "auto"});
    });
});

describe("ConfigStore.register / get / definitionOf", () => {
    it("uses the defaults when there is no config file", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const config = await store.register(definitionOf("alpha"));
        expect(config.enabled).toBe(false);
        expect(store.get("alpha")).toEqual(config);
        expect(store.definitionOf("alpha")?.id).toBe("alpha");
        expect(host.loadData).toHaveBeenCalledWith("feature-alpha");
    });

    it("reads back the existing config and merges it with the defaults", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "stored"});
        const store = new ConfigStore(host.asPlugin());
        const config = await store.register(definitionOf("alpha"));
        expect(config).toEqual({enabled: true, label: "stored", size: 12, mode: "auto"});
    });

    it("treats an empty string from the host (file missing) as no config", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        host.loadData.mockResolvedValueOnce("");
        const config = await store.register(definitionOf("alpha"));
        expect(config.enabled).toBe(false);
    });

    it("falls back to the defaults when reading fails, without blocking registration", async () => {
        const host = new FakeHost();
        host.loadData.mockRejectedValueOnce(new Error("io error"));
        const store = new ConfigStore(host.asPlugin());
        await expect(store.register(definitionOf("alpha"))).resolves.toEqual(
            {enabled: false, label: "hi", size: 12, mode: "auto"},
        );
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });

    it("falls back to the defaults and warns when the config file has bad fields", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: "yes", size: 999});
        const store = new ConfigStore(host.asPlugin());
        const config = await store.register(definitionOf("alpha"));
        expect(config.enabled).toBe(false);
        expect(config.size).toBe(24);
        expect(vi.mocked(console.warn).mock.calls.some((call) => String(call[0]).includes("field problem"))).toBe(true);
    });

    it("an unregistered id returns an empty object", () => {
        const store = new ConfigStore(new FakeHost().asPlugin());
        expect(store.get("nope")).toEqual({});
        expect(store.definitionOf("nope")).toBeUndefined();
    });
});

describe("ConfigStore subscriptions", () => {
    it("notifies subscribers after a patch and stops after unsubscribe", async () => {
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

    it("notifies only the feature that changed", async () => {
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

    it("notifies nothing after dispose", async () => {
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
    it("patch merges, writes to disk and normalizes against the schema", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.patch("alpha", {label: "new"});
        expect(store.get("alpha").label).toBe("new");
        expect(host.files.get("feature-alpha")).toEqual({enabled: false, label: "new", size: 12, mode: "auto"});
    });

    it("patch writes only that feature's file", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.register(definitionOf("beta"));
        host.saveData.mockClear();
        await store.patch("alpha", {enabled: true});
        expect(host.saveData).toHaveBeenCalledTimes(1);
        expect(host.saveData).toHaveBeenCalledWith("feature-alpha", expect.any(Object));
    });

    it("invalid values in a patch fall back to the defaults with a warning", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.patch("alpha", {size: "big"});
        expect(store.get("alpha").size).toBe(12);
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });

    it("values equal to the disk contents are not written again", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.files.set("feature-alpha", {enabled: false, label: "hi", size: 12, mode: "auto"});
        host.saveData.mockClear();
        await store.patch("alpha", {enabled: false});
        await store.patch("alpha", {label: "hi"});
        expect(host.saveData).not.toHaveBeenCalled();
    });

    it("notifies subscribers right after a successful write, without waiting for an app reload", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        store.subscribe("alpha", listener);
        await store.patch("alpha", {enabled: true});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("throws when the write fails and rolls the in-memory state back", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.files.set("feature-alpha", {enabled: false, label: "keep", size: 12, mode: "auto"});
        await store.register(definitionOf("alpha"));
        host.saveData.mockRejectedValueOnce(new Error("disk full"));
        await expect(store.patch("alpha", {label: "changed"})).rejects.toThrow("disk full");
        expect(store.get("alpha").label).toBe("keep");
    });

    it("throws a problem-carrying error when the kernel rejects the write, and the in-memory state rolls back too", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        host.rejectWrites = true;
        await expect(store.patch("alpha", {enabled: true})).rejects.toMatchObject({
            problems: ["feature-alpha: code 1: readonly"],
        });
        expect(store.get("alpha").enabled).toBe(false);
    });

    it("throws when the read-back does not match and rolls the in-memory state back", async () => {
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

    it("writes for one feature run in call order, so an old write cannot overwrite newer config", async () => {
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

    it("a failed write neither blocks later writes nor rolls back their config", async () => {
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

    it("a patch on an unregistered id does nothing", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await expect(store.patch("ghost", {enabled: true})).resolves.toBeUndefined();
        expect(host.saveData).not.toHaveBeenCalled();
    });
});

describe("ConfigStore.clearAll", () => {
    it("deletes every config file in the directory and resets the in-memory state to the defaults", async () => {
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

    it("clearing waits for pending writes to land, so nothing is written back after the deletion", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "old", size: 12, mode: "auto"});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        host.saveData.mockImplementationOnce(async (name: string, value: unknown) => {
            await gate;
            host.files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });

        const patching = store.patch("alpha", {label: "new"});
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));
        const clearing = store.clearAll();
        // 写盘还没回来：清空必须等着，不能先删（否则删完又被写回来）
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(host.removeData).not.toHaveBeenCalled();

        release();
        await patching;
        await clearing;

        expect(host.files.size).toBe(0);
        expect(store.get("alpha")).toMatchObject({label: "hi"});
    });

    it("changes made while clearing are dropped instead of writing the file back", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "old", size: 12, mode: "auto"});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        host.removeData.mockImplementationOnce(async (name: string) => {
            await gate;
            host.files.delete(name);
            return {code: 0};
        });

        const clearing = store.clearAll();
        await vi.waitFor(() => expect(host.removeData).toHaveBeenCalledTimes(1));

        // 删除还没完成时来一次改动：丢弃，不写盘
        await expect(store.patch("alpha", {label: "late"})).resolves.toBeUndefined();
        expect(host.saveData).not.toHaveBeenCalled();

        release();
        await clearing;
        expect(host.files.size).toBe(0);
        expect(store.get("alpha")).toMatchObject({label: "hi"});
    });

    it("a second call while clearing follows the same run and does not delete twice", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        const first = store.clearAll();
        const second = store.clearAll();
        expect(second).toBe(first);
        await Promise.all([first, second]);
        expect(host.files.size).toBe(0);
        expect(host.removeData).toHaveBeenCalledTimes(1);
    });

    it("new changes are persisted as usual once clearing is done", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "old", size: 12, mode: "auto"});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await store.clearAll();
        await store.patch("alpha", {label: "after"});
        expect(host.files.get("feature-alpha")).toMatchObject({label: "after"});
        expect(store.get("alpha")).toMatchObject({label: "after"});
    });

    it("config files with a legacy .json extension are recognized too", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha.json", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.clearAll();
        expect(host.files.size).toBe(0);
    });

    it("config files left behind by features no longer in the code are deleted as well", async () => {
        const host = new FakeHost();
        host.files.set("feature-retired", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.clearAll();
        expect(host.files.size).toBe(0);
    });

    it("files with invalid names are left alone, with only a warning", async () => {
        const host = new FakeHost();
        host.files.set("notes.txt", "keep me");
        host.files.set("feature-alpha", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await store.clearAll();
        expect([...host.files.keys()]).toEqual(["notes.txt"]);
    });

    it("throws and lists every failure when a file cannot be deleted", async () => {
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

    it("throws when the directory cannot be listed instead of pretending it is clean", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: -1, msg: "kernel busy"});
        const store = new ConfigStore(new FakeHost().asPlugin());
        await expect(store.clearAll()).rejects.toThrow("cannot list");
    });
});

describe("ConfigStore.exportAll", () => {
    it("exports the files in the directory, keyed by feature id", async () => {
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

    it("skips files whose content is not an object", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", "not an object");
        host.files.set("feature-beta", [1, 2]);
        host.files.set("feature-gamma", {enabled: true});
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());
        await expect(store.exportAll()).resolves.toEqual({gamma: {enabled: true}});
    });

    it("files that cannot be read are left out of the export", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        serveDirListing(host);
        host.loadData.mockRejectedValueOnce(new Error("io error"));
        const store = new ConfigStore(host.asPlugin());
        await expect(store.exportAll()).resolves.toEqual({});
    });

    it("throws when the directory cannot be listed", async () => {
        mockState.fetchSyncPost.mockRejectedValue(new Error("offline"));
        const store = new ConfigStore(new FakeHost().asPlugin());
        await expect(store.exportAll()).rejects.toThrow("offline");
    });
});

describe("ConfigStore.importMany", () => {
    it("known ids are normalized against the schema and written", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const result = await store.importMany({alpha: {enabled: true, size: 999}});
        expect(result).toEqual({applied: ["alpha"], skipped: []});
        expect(host.files.get("feature-alpha")).toEqual({enabled: true, label: "hi", size: 24, mode: "auto"});
        expect(store.get("alpha").size).toBe(24);
    });

    it("notifies subscribers right after an import, without waiting for a page reload", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const listener = vi.fn();
        store.subscribe("alpha", listener);
        await store.importMany({alpha: {enabled: true}});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("unknown ids are written back to their own file as-is", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const result = await store.importMany({retired: {anything: [1, 2]}});
        expect(result).toEqual({applied: ["retired"], skipped: []});
        expect(host.files.get("feature-retired")).toEqual({anything: [1, 2]});
    });

    it("a feature that is in the registry but not loaded on this host is still validated against its schema", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        // mobile-console-log 在注册表里；这里没有 register 它，模拟「本宿主不加载」
        await expect(store.importMany({"mobile-console-log": {enabled: "yes"}})).rejects.toMatchObject({
            problems: [expect.stringContaining('mobile-console-log: "enabled" should be boolean')],
        });
    });

    it("importing a registry feature that was never registered here does not conjure in-memory state", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        const result = await store.importMany({"mobile-console-log": {enabled: true}});
        expect(result).toEqual({applied: ["mobile-console-log"], skipped: []});
        expect(host.files.get("feature-mobile-console-log")).toMatchObject({enabled: true});
        // 没有注册就没有内存态，下次真正加载时再从磁盘读
        expect(store.get("mobile-console-log")).toEqual({});
    });

    it("entries with an invalid id or a non-object value are never written and go back to the caller to report", async () => {
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

    it("nothing is written when a known id has bad fields", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        await expect(store.importMany({alpha: {enabled: 1}, retired: {enabled: true}})).rejects.toMatchObject({
            problems: [expect.stringContaining('alpha: "enabled" should be boolean')],
        });
        expect(host.files.size).toBe(0);
    });

    it("an import waits for pending writes to land, so old writes cannot overwrite its result", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: false, label: "old", size: 12, mode: "auto"});
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        host.saveData.mockImplementationOnce(async (name: string, value: unknown) => {
            await gate;
            host.files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });
        const patching = store.patch("alpha", {label: "old patch value"});
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));

        const importing = store.importMany({alpha: {label: "imported value"}});
        release();
        await patching;
        await importing;

        expect(host.files.get("feature-alpha")).toMatchObject({label: "imported value"});
        expect(store.get("alpha")).toMatchObject({label: "imported value"});
    });

    it("changes made during an import are dropped instead of writing old values back afterwards", async () => {
        const host = new FakeHost();
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        host.saveData.mockImplementationOnce(async (name: string, value: unknown) => {
            await gate;
            host.files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });

        const importing = store.importMany({alpha: {label: "imported value"}});
        await vi.waitFor(() => expect(host.saveData).toHaveBeenCalledTimes(1));
        // 导入写盘还没回来时来一次改动：丢弃，不写盘
        await expect(store.patch("alpha", {label: "change after import"})).resolves.toBeUndefined();
        expect(host.saveData).toHaveBeenCalledTimes(1);

        release();
        await importing;
        expect(host.files.get("feature-alpha")).toMatchObject({label: "imported value"});
        expect(store.get("alpha")).toMatchObject({label: "imported value"});
    });

    it("restores the files already written when an import fails partway", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: false, label: "a-old", size: 12, mode: "auto"});
        host.files.set("feature-beta", {enabled: false, label: "b-old"});
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const original = host.saveData.getMockImplementation() as (name: string, value: unknown) => Promise<unknown>;
        let betaAttempts = 0;
        host.saveData.mockImplementation(async (name: string, value: unknown) => {
            // beta 的第一次写入失败，回滚时的第二次放行
            if (name === "feature-beta" && betaAttempts++ === 0) {
                return {code: 1, msg: "readonly"};
            }
            return original(name, value);
        });

        await expect(store.importMany({alpha: {label: "a-new"}, beta: {label: "b-new"}})).rejects.toMatchObject({
            problems: ["feature-beta: code 1: readonly"],
        });

        // 写进去的 alpha 必须退回，没写成功的 beta 保持原样，内存态也不能变
        expect(host.files.get("feature-alpha")).toMatchObject({label: "a-old"});
        expect(host.files.get("feature-beta")).toMatchObject({label: "b-old"});
        expect(store.get("alpha")).toMatchObject({label: "a-old"});
    });

    it("reports the files it could not restore when the rollback fails too", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: false, label: "a-old", size: 12, mode: "auto"});
        host.files.set("feature-beta", {enabled: false, label: "b-old"});
        const store = new ConfigStore(host.asPlugin());
        await store.register(definitionOf("alpha"));
        const original = host.saveData.getMockImplementation() as (name: string, value: unknown) => Promise<unknown>;
        host.saveData.mockImplementation(async (name: string, value: unknown) => {
            if (name === "feature-beta") {
                return {code: 1, msg: "readonly"};
            }
            return original(name, value);
        });

        await expect(store.importMany({alpha: {label: "a-new"}, beta: {label: "b-new"}})).rejects.toMatchObject({
            problems: [
                "feature-beta: code 1: readonly",
                "feature-beta: cannot restore the previous content (code 1: readonly)",
            ],
        });
        expect(host.files.get("feature-alpha")).toMatchObject({label: "a-old"});
        expect(store.get("alpha")).toMatchObject({label: "a-old"});
    });

    it("throws a problem-carrying error when the write fails", async () => {
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
    it("reads config files concurrently and does not read again after register", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true, label: "stored"});
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

        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: true, label: "stored"});
        await expect(store.register(definitionOf("beta"))).resolves.toMatchObject({enabled: false});
        // 预读过的文件不再读第二次
        expect(host.loadData.mock.calls.length).toBe(reads);
    });

    it("a feature whose prefetch failed falls back to the defaults and logs a warning", async () => {
        const host = new FakeHost();
        host.loadData.mockRejectedValueOnce(new Error("offline"));
        const store = new ConfigStore(host.asPlugin());
        await store.prefetch([definitionOf("alpha")]);

        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: false, label: "hi"});
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });

    it("a slow file only delays its own register", async () => {
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

    it("a feature that was never prefetched still reads from disk on the spot", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        const store = new ConfigStore(host.asPlugin());
        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({enabled: true});
        expect(host.loadData).toHaveBeenCalledWith("feature-alpha");
    });

    it("prefetch results are consumed once and never override later changes", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        const store = new ConfigStore(host.asPlugin());
        await store.prefetch([definitionOf("alpha")]);
        await store.register(definitionOf("alpha"));
        // 第二次注册（例如设置面板重建）必须重新读盘，拿到的是最新值
        host.files.set("feature-alpha", {enabled: false, label: "new value"});
        await expect(store.register(definitionOf("alpha"))).resolves.toMatchObject({
            enabled: false,
            label: "new value",
        });
    });
});

describe("files that are not feature configurations", () => {
    /** 用户级声明补丁：它和配置放在同一个目录里，但三个整体动作都不能碰它。 */
    const PATCH = "features:\n  alpha:\n    enabled: false\n";

    it("export, clear and import leave the patch file untouched", async () => {
        const host = new FakeHost();
        host.files.set("feature-alpha", {enabled: true});
        host.files.set(".patch.yml", PATCH);
        serveDirListing(host);
        const store = new ConfigStore(host.asPlugin());

        // 导出只含配置文件
        await expect(store.exportAll()).resolves.toEqual({alpha: {enabled: true}});
        // 导入只写配置文件
        await expect(store.importMany({alpha: {enabled: false}})).resolves.toMatchObject({applied: ["alpha"]});
        expect(host.files.get(".patch.yml")).toBe(PATCH);
        // 清除只删配置文件：补丁由用户自己维护，卸载时才随目录一起消失
        await store.clearAll();
        expect(host.files.has("feature-alpha")).toBe(false);
        expect(host.files.get(".patch.yml")).toBe(PATCH);
    });
});
