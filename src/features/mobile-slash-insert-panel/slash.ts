/**
 * 打开「桌面端插入块面板」的实现。
 *
 * 只改内核自己的那个前端偏好，所以渲染、插入、搜索全部沿用内核原有的代码路径，
 * 插件不复制任何候选列表。
 *
 * 保持打开用低频复检实现：用户可能在「设置 - 编辑器」里把它关掉，关掉之后
 * 就再也没有事件通知我们，只能定期看一眼。每次复检只读一个属性，开销可忽略。
 */
import {fetchPost} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 内核的前端偏好 key（Constants.LOCAL_MOBILE_SLASH_MENU）。 */
const STORAGE_KEY = "local-mobile-slash-menu";
/** 复检间隔。 */
const RECHECK_INTERVAL_MS = 1500;
/** 该偏好的取值形态只有布尔开关，用扁平的 Record 描述即可。 */
type SlashMenuFlag = Record<string, boolean>;

const storageOf = (): Record<string, unknown> | undefined =>
    (window as unknown as {siyuan?: {storage?: Record<string, unknown>;};}).siyuan?.storage;

/** 只保留布尔项，避免把未知结构写回内核。 */
const readFlag = (): SlashMenuFlag => {
    const value = storageOf()?.[STORAGE_KEY];
    if (typeof value !== "object" || value === null) {
        return {};
    }
    const result: SlashMenuFlag = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
        if (typeof item === "boolean") {
            result[key] = item;
        }
    });
    return result;
};

/** 与内核 setStorageVal 走同一个接口；偏好本身不回写内存，所以内存要自己设。 */
const persist = (value: SlashMenuFlag): void => {
    fetchPost("/api/storage/setLocalStorageVal", {
        app: "some-settings-siyuan",
        key: STORAGE_KEY,
        val: {...value},
    });
};

/**
 * 写盘后读回校验：宿主的接口在真正落盘前就可能 resolve，不校验等于静默失败
 * （与 `core/config.ts` 的约定一致）。内存里那一份已经生效，所以失败也必须让用户看见，
 * 否则现象就是"重开之后这个功能自己失效了"。
 */
const verify = (host: FeatureHost, expected: boolean): void => {
    fetchPost("/api/storage/getLocalStorageVal", {key: STORAGE_KEY}, (response) => {
        const stored = response.code === 0 ? (response.data as SlashMenuFlag | null) : null;
        if (stored?.enabled === expected) {
            return;
        }
        host.log(`读回 ${STORAGE_KEY} 与写入不一致：${JSON.stringify(stored ?? null)}`);
        host.showMessage(host.i18n("mobileSlashPanel.saveFailed"));
    });
};

export const mountMobileSlashPanel = (host: FeatureHost): FeatureInstance => {
    const saved = readFlag();

    const apply = (): void => {
        const target = storageOf();
        if (!target) {
            return;
        }
        if ((target[STORAGE_KEY] as SlashMenuFlag | undefined)?.enabled === true) {
            return;
        }
        const next: SlashMenuFlag = {...readFlag(), enabled: true};
        target[STORAGE_KEY] = next;
        persist(next);
        verify(host, true);
    };

    apply();
    const timer = window.setInterval(apply, RECHECK_INTERVAL_MS);

    return {
        destroy: () => {
            window.clearInterval(timer);
            const target = storageOf();
            if (!target) {
                return;
            }
            const restore: SlashMenuFlag = saved.enabled === true ? saved : {enabled: false};
            target[STORAGE_KEY] = restore;
            persist(restore);
            host.log("已把移动端斜杠菜单偏好恢复成原值");
        },
    };
};
