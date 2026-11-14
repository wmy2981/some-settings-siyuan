// @vitest-environment node
/**
 * `core/storage.ts`：插件私有存储目录的文件级访问。
 *
 * 三条约定必须成立，否则导出 / 清除就会静默失效：
 * - 列不出目录时抛出，绝不退化成「一个文件都没有」；
 * - 目录还不存在（404）按空处理；
 * - 写 / 删都以内核响应的 code 为准，「没抛错」不算成功。
 */
import type {Plugin} from "siyuan";
import type {Mock} from "vitest";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {setDetailedLogging} from "../../src/core/log";
import {
    CONFIG_IO_CONCURRENCY,
    listStoredFiles,
    mapLimit,
    readStoredFile,
    removeStorageDir,
    removeStoredFile,
    writeStoredFile,
} from "../../src/core/storage";
import {mockState} from "../mocks/siyuan";

const PLUGIN_NAME = "some-settings-siyuan";

beforeEach(() => {
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});
const STORAGE_DIR = `/data/storage/petal/${PLUGIN_NAME}`;

/** 只实现核心用到的那四个成员；其余由宿主的 Plugin 提供。 */
interface FakePlugin {
    name: string;
    loadData: Mock;
    saveData: Mock;
    removeData: Mock;
}

const makePlugin = (): FakePlugin => ({
    name: PLUGIN_NAME,
    loadData: vi.fn(async () => ""),
    saveData: vi.fn(async () => ({code: 0})),
    removeData: vi.fn(async () => ({code: 0})),
});

/** 核心只通过这些成员访问宿主，其余属性留空即可。 */
const asPlugin = (plugin: FakePlugin): Plugin => plugin as unknown as Plugin;

describe("listStoredFiles", () => {
    it("用内核的 /api/file/readDir 列插件自己的目录，并关掉宿主报错", async () => {
        const plugin = makePlugin();
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: [{name: "feature-a", isDir: false}]});
        await expect(listStoredFiles(asPlugin(plugin))).resolves.toEqual(["feature-a"]);
        expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
            "/api/file/readDir",
            {path: STORAGE_DIR},
            undefined,
            false,
        );
    });

    it("目录不存在（404）时返回空数组", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 404, msg: "not found"});
        await expect(listStoredFiles(asPlugin(makePlugin()))).resolves.toEqual([]);
    });

    it("其他失败一律抛出，绝不假装目录是空的", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: -1, msg: "kernel busy"});
        await expect(listStoredFiles(asPlugin(makePlugin()))).rejects.toThrow(
            `cannot list ${STORAGE_DIR}: code -1: kernel busy`,
        );
    });

    it("内核回负数时不会一直悬着（走 fetchSyncPost 而不是 fetchPost）", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: -1});
        await expect(listStoredFiles(asPlugin(makePlugin()))).rejects.toThrow("code -1");
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });

    it("只收文件名，跳过子目录与非字符串名字", async () => {
        mockState.fetchSyncPost.mockResolvedValue({
            code: 0,
            data: [
                {name: "feature-a", isDir: false},
                {name: "icons", isDir: true},
                {name: 42, isDir: false},
                {isDir: false},
                {name: "feature-b"},
            ],
        });
        await expect(listStoredFiles(asPlugin(makePlugin()))).resolves.toEqual(["feature-a", "feature-b"]);
    });

    it("data 不是数组时按空处理", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: null});
        await expect(listStoredFiles(asPlugin(makePlugin()))).resolves.toEqual([]);
    });

    it("网络层异常向上抛给调用方", async () => {
        mockState.fetchSyncPost.mockRejectedValue(new Error("offline"));
        await expect(listStoredFiles(asPlugin(makePlugin()))).rejects.toThrow("offline");
    });
});

describe("readStoredFile", () => {
    it("读到内容时原样返回", async () => {
        const plugin = makePlugin();
        plugin.loadData = vi.fn(async () => ({enabled: true}));
        await expect(readStoredFile(asPlugin(plugin), "feature-a")).resolves.toEqual({enabled: true});
    });

    it("文件不存在时宿主兑现空串，按 null 处理", async () => {
        const plugin = makePlugin();
        plugin.loadData = vi.fn(async () => "");
        await expect(readStoredFile(asPlugin(plugin), "feature-a")).resolves.toBeNull();
    });

    it("读失败时告警并返回 null", async () => {
        const plugin = makePlugin();
        plugin.loadData = vi.fn(async () => {
            throw new Error("gone");
        });
        await expect(readStoredFile(asPlugin(plugin), "feature-a")).resolves.toBeNull();
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });
});

describe("writeStoredFile", () => {
    it("内核收下时 ok 为真并带上 code", async () => {
        const plugin = makePlugin();
        await expect(writeStoredFile(asPlugin(plugin), "feature-a", {enabled: true})).resolves.toEqual({
            ok: true,
            code: 0,
            detail: "code 0",
        });
        expect(plugin.saveData).toHaveBeenCalledWith("feature-a", {enabled: true});
    });

    it("code 非 0 时判为失败，detail 带内核 code 与 msg", async () => {
        const plugin = makePlugin();
        plugin.saveData = vi.fn(async () => ({code: 1, msg: "denied"}));
        await expect(writeStoredFile(asPlugin(plugin), "feature-a", {})).resolves.toEqual({
            ok: false,
            code: 1,
            detail: "code 1: denied",
        });
    });

    it("宿主没有兑现结构化响应时也判为失败", async () => {
        const plugin = makePlugin();
        plugin.saveData = vi.fn(async () => undefined);
        const status = await writeStoredFile(asPlugin(plugin), "feature-a", {});
        expect(status.ok).toBe(false);
        expect(status.detail).toContain("unexpected kernel response");
    });

    it("宿主直接抛错时判为失败并告警", async () => {
        const plugin = makePlugin();
        plugin.saveData = vi.fn(async () => {
            throw new Error("disk full");
        });
        const status = await writeStoredFile(asPlugin(plugin), "feature-a", {});
        expect(status.ok).toBe(false);
        expect(status.detail).toContain("disk full");
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });
});

describe("removeStoredFile", () => {
    it("删成功，以及文件本来就不在（404）都算达成目标", async () => {
        const plugin = makePlugin();
        await expect(removeStoredFile(asPlugin(plugin), "feature-a")).resolves.toEqual({
            ok: true,
            code: 0,
            detail: "code 0",
        });
        plugin.removeData = vi.fn(async () => ({code: 404}));
        await expect(removeStoredFile(asPlugin(plugin), "feature-b")).resolves.toEqual({
            ok: true,
            code: 404,
            detail: "code 404",
        });
    });

    it("其他 code 判为失败", async () => {
        const plugin = makePlugin();
        plugin.removeData = vi.fn(async () => ({code: 500, msg: "io error"}));
        await expect(removeStoredFile(asPlugin(plugin), "feature-a")).resolves.toEqual({
            ok: false,
            code: 500,
            detail: "code 500: io error",
        });
    });

    it("宿主抛错时判为失败并告警", async () => {
        const plugin = makePlugin();
        plugin.removeData = vi.fn(async () => {
            throw new Error("no permission");
        });
        const status = await removeStoredFile(asPlugin(plugin), "feature-a");
        expect(status.ok).toBe(false);
        expect(status.detail).toContain("no permission");
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });
});

describe("removeStorageDir", () => {
    it("删的是整个存储目录", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0});
        await expect(removeStorageDir(asPlugin(makePlugin()))).resolves.toEqual({ok: true, code: 0, detail: "code 0"});
        expect(mockState.fetchSyncPost).toHaveBeenCalledWith(
            "/api/file/removeFile",
            {path: STORAGE_DIR},
            undefined,
            false,
        );
    });

    it("目录本来就不在也算成功", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 404});
        await expect(removeStorageDir(asPlugin(makePlugin()))).resolves.toEqual({
            ok: true,
            code: 404,
            detail: "code 404",
        });
    });

    it("其他 code 判为失败", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 403, msg: "readonly"});
        await expect(removeStorageDir(asPlugin(makePlugin()))).resolves.toEqual({
            ok: false,
            code: 403,
            detail: "code 403: readonly",
        });
    });

    it("请求抛错时判为失败并告警", async () => {
        mockState.fetchSyncPost.mockRejectedValue(new Error("offline"));
        const status = await removeStorageDir(asPlugin(makePlugin()));
        expect(status.ok).toBe(false);
        expect(status.detail).toContain("offline");
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });
});

describe("mapLimit", () => {
    it("结果按输入顺序返回，与完成顺序无关", async () => {
        const delays = [30, 5, 20, 1];
        const results = await mapLimit(delays, 4, async (delay, index) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return index;
        });
        expect(results).toEqual([0, 1, 2, 3]);
    });

    it("同时运行的任务不超过上限", async () => {
        let running = 0;
        let peak = 0;
        await mapLimit(Array.from({length: 12}, (_, index) => index), CONFIG_IO_CONCURRENCY, async () => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 2));
            running -= 1;
            return undefined;
        });
        expect(peak).toBe(CONFIG_IO_CONCURRENCY);
    });

    it("空清单直接把空数组交回去", async () => {
        const run = vi.fn();
        await expect(mapLimit([], 4, run)).resolves.toEqual([]);
        expect(run).not.toHaveBeenCalled();
    });

    it("并发度按上限切分，不会把整批同时压出去", async () => {
        let running = 0;
        let peak = 0;
        const results = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 2));
            running -= 1;
            return value * 2;
        });
        expect(results).toEqual([2, 4, 6, 8, 10]);
        expect(peak).toBe(2);
    });

    it("上限为 0 时至少跑一个，不会卡死", async () => {
        const run = vi.fn(async (value: number) => value);
        await expect(mapLimit([1, 2, 3], 0, run)).resolves.toEqual([1, 2, 3]);
        expect(run).toHaveBeenCalledTimes(3);
    });

    it("任务抛错后，其余的仍会被存活的 worker 跑完", async () => {
        const ran: number[] = [];
        void mapLimit([1, 2, 3, 4], 2, async (value) => {
            ran.push(value);
            if (value === 1) {
                throw new Error("boom");
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
            return value;
        }).catch(() => undefined);
        await vi.waitFor(() => expect(ran).toHaveLength(4));
        expect([...ran].sort()).toEqual([1, 2, 3, 4]);
    });

    it("任务抛错时整体拒绝", async () => {
        await expect(mapLimit([1, 2, 3], 2, async (value) => {
            if (value === 2) {
                throw new Error("boom");
            }
            return value;
        })).rejects.toThrow("boom");
    });
});
