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
    it("lists the plugin own directory via the kernel /api/file/readDir and silences host errors", async () => {
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

    it("returns an empty array when the directory is missing (404)", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 404, msg: "not found"});
        await expect(listStoredFiles(asPlugin(makePlugin()))).resolves.toEqual([]);
    });

    it("throws on any other failure instead of pretending the directory is empty", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: -1, msg: "kernel busy"});
        await expect(listStoredFiles(asPlugin(makePlugin()))).rejects.toThrow(
            `cannot list ${STORAGE_DIR}: code -1: kernel busy`,
        );
    });

    it("does not hang on a negative kernel code (uses fetchSyncPost, not fetchPost)", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: -1});
        await expect(listStoredFiles(asPlugin(makePlugin()))).rejects.toThrow("code -1");
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });

    it("collects file names only, skipping subdirectories and non-string names", async () => {
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

    it("treats a non-array data as empty", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: null});
        await expect(listStoredFiles(asPlugin(makePlugin()))).resolves.toEqual([]);
    });

    it("network errors propagate to the caller", async () => {
        mockState.fetchSyncPost.mockRejectedValue(new Error("offline"));
        await expect(listStoredFiles(asPlugin(makePlugin()))).rejects.toThrow("offline");
    });
});

describe("readStoredFile", () => {
    it("returns the content as-is when it can be read", async () => {
        const plugin = makePlugin();
        plugin.loadData = vi.fn(async () => ({enabled: true}));
        await expect(readStoredFile(asPlugin(plugin), "feature-a")).resolves.toEqual({enabled: true});
    });

    it("an empty string resolved for a missing file is treated as null", async () => {
        const plugin = makePlugin();
        plugin.loadData = vi.fn(async () => "");
        await expect(readStoredFile(asPlugin(plugin), "feature-a")).resolves.toBeNull();
    });

    it("warns and returns null when reading fails", async () => {
        const plugin = makePlugin();
        plugin.loadData = vi.fn(async () => {
            throw new Error("gone");
        });
        await expect(readStoredFile(asPlugin(plugin), "feature-a")).resolves.toBeNull();
        expect(vi.mocked(console.warn)).toHaveBeenCalled();
    });
});

describe("writeStoredFile", () => {
    it("ok is true with the code when the kernel accepts it", async () => {
        const plugin = makePlugin();
        await expect(writeStoredFile(asPlugin(plugin), "feature-a", {enabled: true})).resolves.toEqual({
            ok: true,
            code: 0,
            detail: "code 0",
        });
        expect(plugin.saveData).toHaveBeenCalledWith("feature-a", {enabled: true});
    });

    it("a non-zero code counts as a failure and detail carries the kernel code and msg", async () => {
        const plugin = makePlugin();
        plugin.saveData = vi.fn(async () => ({code: 1, msg: "denied"}));
        await expect(writeStoredFile(asPlugin(plugin), "feature-a", {})).resolves.toEqual({
            ok: false,
            code: 1,
            detail: "code 1: denied",
        });
    });

    it("a host that resolves no structured response also counts as a failure", async () => {
        const plugin = makePlugin();
        plugin.saveData = vi.fn(async () => undefined);
        const status = await writeStoredFile(asPlugin(plugin), "feature-a", {});
        expect(status.ok).toBe(false);
        expect(status.detail).toContain("unexpected kernel response");
    });

    it("a host that throws counts as a failure and warns", async () => {
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
    it("a successful delete and an already-missing file (404) both reach the goal", async () => {
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

    it("any other code counts as a failure", async () => {
        const plugin = makePlugin();
        plugin.removeData = vi.fn(async () => ({code: 500, msg: "io error"}));
        await expect(removeStoredFile(asPlugin(plugin), "feature-a")).resolves.toEqual({
            ok: false,
            code: 500,
            detail: "code 500: io error",
        });
    });

    it("a host that throws counts as a failure and warns", async () => {
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

describe("mapLimit", () => {
    it("results keep the input order regardless of completion order", async () => {
        const delays = [30, 5, 20, 1];
        const results = await mapLimit(delays, 4, async (delay, index) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return index;
        });
        expect(results).toEqual([0, 1, 2, 3]);
    });

    it("concurrent tasks never exceed the limit", async () => {
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

    it("an empty list resolves to an empty array", async () => {
        const run = vi.fn();
        await expect(mapLimit([], 4, run)).resolves.toEqual([]);
        expect(run).not.toHaveBeenCalled();
    });

    it("concurrency is sliced by the limit rather than firing the whole batch at once", async () => {
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

    it("a limit of 0 still runs at least one task without hanging", async () => {
        const run = vi.fn(async (value: number) => value);
        await expect(mapLimit([1, 2, 3], 0, run)).resolves.toEqual([1, 2, 3]);
        expect(run).toHaveBeenCalledTimes(3);
    });

    it("after a task throws the surviving workers still finish the rest", async () => {
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

    it("rejects as a whole when a task throws", async () => {
        await expect(mapLimit([1, 2, 3], 2, async (value) => {
            if (value === 2) {
                throw new Error("boom");
            }
            return value;
        })).rejects.toThrow("boom");
    });
});
