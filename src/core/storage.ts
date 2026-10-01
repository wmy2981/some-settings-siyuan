/**
 * 插件私有存储目录（/data/storage/petal/<插件名>/）的文件级访问。
 *
 * 「导出 / 导入 / 清除配置」的目标集合是目录里的**文件**，不是代码里注册的功能：
 * feature-control 的四态、前端适配、`deprecatedSince` 都只决定功能加不加载，
 * 不决定配置还在不在。所以这三个动作都从这里出发，退役的、甚至已经从插件里删掉的
 * 功能留下的配置文件一样能被导出、导入和清除。
 *
 * 读 / 写 / 删仍然只走 plugin.loadData / saveData / removeData；
 * 只有「列出目录里有哪些文件」没有对应的插件 API，走内核的 /api/file/readDir
 * （内核 API 是官方允许的入口，不用 fs / Node API）。
 */
import {fetchSyncPost} from "siyuan";
import type {Plugin} from "siyuan";

const PREFIX = "[some-settings-siyuan]";

/** 插件在思源工作空间里的私有目录。 */
const storageDirOf = (plugin: Plugin): string => `/data/storage/petal/${plugin.name}`;

/** 内核响应的最小形状：宿主只保证 Promise 会兑现，不保证 code 为 0。 */
interface KernelResponse {
    code?: number;
    msg?: string;
    data?: unknown;
}

/** 一次文件操作的结局。写 / 删都要看它，不能拿「没抛错」当成功。 */
export interface StorageStatus {
    ok: boolean;
    /** 内核响应里的 code；拿不到响应时为 undefined。 */
    code?: number;
    /** 失败原因，直接进问题清单，所以带上内核的 code。 */
    detail: string;
}

const statusOf = (response: unknown): StorageStatus => {
    if (typeof response !== "object" || response === null) {
        return {ok: false, detail: `unexpected kernel response ${JSON.stringify(response)}`};
    }
    const {code, msg} = response as KernelResponse;
    return {ok: code === 0, code, detail: `code ${String(code)}${msg ? `: ${msg}` : ""}`};
};

/**
 * 列目录里的文件名（不含子目录）。
 *
 * 目录还不存在是正常状态 —— 一个配置都还没写过 —— 按「空」处理。
 * 其他失败一律抛出：列不出目录却说「没有配置」，会让导出给出一份空文档、
 * 让清除看起来成功其实什么都没删，这正是这两个动作最不该有的结果。
 *
 * 用 fetchSyncPost 而不是 fetchPost：后者只在 code 非负时才回调，
 * 内核回一个负数（如 -1）时它的 Promise 会永远悬着，导出 / 清除就再也没下文了。
 */
export const listStoredFiles = async (plugin: Plugin): Promise<string[]> => {
    const dir = storageDirOf(plugin);
    // 关掉宿主自己的报错提示：列不出目录由调用方决定怎么处理，不该弹一个没人能处理的错。
    // 网络层失败直接往上报，调用方（动作行 / 清除流程）本来就会把异常显示给用户。
    const response: KernelResponse = await fetchSyncPost("/api/file/readDir", {path: dir}, undefined, false);
    if (response.code === 404) {
        return [];
    }
    if (response.code !== 0) {
        throw new Error(`cannot list ${dir}: code ${String(response.code)}${response.msg ? `: ${response.msg}` : ""}`);
    }
    const entries = Array.isArray(response.data) ? response.data as {name?: unknown; isDir?: unknown;}[] : [];
    return entries
        .filter((entry) => typeof entry.name === "string" && entry.isDir !== true)
        .map((entry) => entry.name as string);
};

/** 读文件内容；文件不存在或读不到时返回 null（宿主对不存在的文件兑现空串）。 */
export const readStoredFile = async (plugin: Plugin, storageName: string): Promise<unknown> => {
    try {
        const stored = await plugin.loadData(storageName);
        return stored === "" ? null : stored;
    } catch (error) {
        console.warn(`${PREFIX} failed to read ${storageName}`, error);
        return null;
    }
};

/** 写文件。到底写进去没有由调用方读回校验，这里只回答内核收没收。 */
export const writeStoredFile = async (
    plugin: Plugin,
    storageName: string,
    value: unknown,
): Promise<StorageStatus> => {
    try {
        return statusOf(await plugin.saveData(storageName, value));
    } catch (error) {
        console.warn(`${PREFIX} failed to write ${storageName}`, error);
        return {ok: false, detail: String(error)};
    }
};

/** 删文件。内核说「文件不在」（404）也算达成目标 —— 要的结果就是它不在。 */
export const removeStoredFile = async (plugin: Plugin, storageName: string): Promise<StorageStatus> => {
    try {
        const status = statusOf(await plugin.removeData(storageName));
        return status.code === 404 ? {...status, ok: true} : status;
    } catch (error) {
        console.warn(`${PREFIX} failed to remove ${storageName}`, error);
        return {ok: false, detail: String(error)};
    }
};
