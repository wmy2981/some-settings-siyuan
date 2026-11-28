/**
 * 面向其他思源插件的设置控制 API 与接管状态管理。
 *
 * 目的：当其他插件与本插件的某个功能存在兼容性冲突时，允许对方以受控方式开启或关闭
 * 该功能的持久化配置（`feature-<id>`），并在本插件设置页明确告知用户：
 *
 * - 接管模式（`takeover: true`）：改写配置文件、锁定该功能的全部设置控件（变灰不可编辑，
 *   但标题、说明与黄色提示保持清晰可读），并在设置页常显黄色提示。接管仅在本次运行有效
 *   （内存态）：对方主动释放、停用卸载或重启后不再声明即自动解锁，不会造成永久锁死；
 *   解除接管后保持已落盘的配置值，不自动回滚原值。
 * - 非接管模式（`takeover: false`）：改写配置文件，不锁定控件；仅当配置实际发生变更时
 *   记录并持久化一条黄色提示（独立存放在 `external-notices`，不污染 `feature-*` 配置与
 *   导出文件），重启后依然显示，直到用户编辑该功能的设置或清空/导入配置后清除。
 *
 * 冲突与边界：
 * - 仅允许控制当前宿主可用、带开关且不属于「插件自身」（`plugin`）分类的功能；
 * - 多个插件同时接管同一功能且目标值一致时共同持有锁（全部释放才解锁）；
 * - 已有接管时，非接管调用或目标值冲突的接管调用直接拒绝（先来先得）。
 */
import type {Plugin} from "siyuan";
import {unavailableReasons} from "./availability";
import type {ConfigStore} from "./config";
import {createLogger} from "./log";
import {
    effectiveFeatures,
    featureById,
} from "./registry";
import {
    readStoredFile,
    removeStoredFile,
    writeStoredFile,
} from "./storage";
import type {
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";

const log = createLogger("core.api");

/** 对外 API 版本号，供调用方做能力判断。 */
export const EXTERNAL_API_VERSION = 1;

/** 插件初始化完成、对外 API 就绪时在 `window` 上派发的自定义事件名。 */
export const EXTERNAL_API_READY_EVENT = "some-settings-siyuan:ready";

/** 插件卸载、对外 API 失效时在 `window` 上派发的自定义事件名。 */
export const EXTERNAL_API_UNLOAD_EVENT = "some-settings-siyuan:unload";

/** 非接管模式黄色提示的持久化文件名（不以 `feature-` 开头，不混入配置导出）。 */
export const EXTERNAL_NOTICES_STORAGE = "external-notices";

/** 可选补充原因：支持纯字符串或按界面语言映射的对象（如 `{"zh-CN": "...", en: "..."}`）。 */
export type LocalizedReason = string | Partial<Record<string, string>>;

/** 调用方身份：插件名字符串，或直接传入思源 `Plugin` 实例。 */
export type ExternalCaller = string | {name: string; displayName?: string;};

/** 外部控制请求。 */
export interface ExternalControlRequest {
    /** 调用方插件名，或直接传入思源 `Plugin` 实例。 */
    caller: ExternalCaller;
    /** 目标功能 id（如 `"modal-blur"`）。 */
    featureId: string;
    /**
     * 目标开关状态：
     * - 布尔开关功能：`true`（开启）或 `false`（关闭）；
     * - 下拉型开关功能：`false`（设为该功能的关闭默认值）或具体的合法选项值字符串。
     */
    enabled: boolean | string;
    /** 是否接管并锁定该功能控件（默认 `false`）。 */
    takeover?: boolean;
    /** 可选补充原因，会附在设置页黄色提示之后。 */
    reason?: LocalizedReason;
}

/** 调用失败时的错误码。 */
export type ExternalControlErrorCode =
    | "invalid-caller"
    | "invalid-feature"
    | "protected"
    | "unavailable"
    | "no-switch"
    | "invalid-value"
    | "readonly"
    | "conflict"
    | "write-failed"
    | "disposed";

/** `setFeature` / `disableFeature` / `enableFeature` 的返回结果。 */
export type ExternalControlResult =
    | {
        ok: true;
        featureId: string;
        /** 实际写入或校验的主控字段名。 */
        key: string;
        /** 实际生效的主控字段值。 */
        value: boolean | string;
        /** 本次调用是否实际改变了磁盘上的配置值。 */
        changed: boolean;
        /** 本次调用后调用方是否持有接管锁。 */
        takeover: boolean;
        /** 释放句柄：仅接管调用有效，重复调用幂等。 */
        release: () => void;
    }
    | {
        ok: false;
        featureId: string;
        code: ExternalControlErrorCode;
        message: string;
        /** 冲突时当前持有接管的插件名列表。 */
        holders?: string[];
    };

/** 释放接管的结果。 */
export interface ExternalReleaseResult {
    /** 本次实际释放的接管条目数。 */
    released: number;
    /** 受影响的功能 id 列表。 */
    featureIds: string[];
}

/** 一条生效中的接管记录（对外只读快照）。 */
export interface ExternalTakeoverInfo {
    caller: string;
    displayName?: string;
    key: string;
    value: boolean | string;
    reason?: LocalizedReason;
}

/** 一条持久化保存的非接管提示记录（对外只读快照）。 */
export interface ExternalNoticeInfo {
    caller: string;
    displayName?: string;
    key: string;
    value: boolean | string;
    reason?: LocalizedReason;
    updatedAt: number;
}

/** 一个功能的主控开关元信息。 */
export interface FeatureSwitchInfo {
    key: string;
    kind: "switch" | "select";
    options?: string[];
    offValue: boolean | string;
}

/** 单个功能对外暴露的只读状态。 */
export interface ExternalFeatureState {
    featureId: string;
    exists: boolean;
    available: boolean;
    controllable: boolean;
    uncontrollableReason?: "invalid-feature" | "protected" | "unavailable" | "no-switch";
    switchField?: FeatureSwitchInfo;
    value?: boolean | string;
    enabled?: boolean;
    takeovers: ExternalTakeoverInfo[];
    notice?: ExternalNoticeInfo;
}

/** 挂在插件实例 `plugin.api` 上的公开接口。 */
export interface SomeSettingsPublicApi {
    readonly version: number;
    readonly pluginName: string;
    /** 等待插件初始化完成（`setFeature` 等异步方法内部也会自动等待）。 */
    ready(): Promise<void>;
    /** 开启、关闭或接管一个功能。 */
    setFeature(request: ExternalControlRequest): Promise<ExternalControlResult>;
    /** 关闭一个功能（布尔与下拉型开关通用）。 */
    disableFeature(
        caller: ExternalCaller,
        featureId: string,
        options?: {takeover?: boolean; reason?: LocalizedReason;},
    ): Promise<ExternalControlResult>;
    /** 开启一个功能（布尔开关默认 `true`；多选项下拉开关可通过 `options.value` 指定档位）。 */
    enableFeature(
        caller: ExternalCaller,
        featureId: string,
        options?: {value?: string; takeover?: boolean; reason?: LocalizedReason;},
    ): Promise<ExternalControlResult>;
    /** 释放指定调用方对指定功能的接管；幂等。 */
    release(caller: ExternalCaller, featureId: string): ExternalReleaseResult;
    /** 释放指定调用方持有的全部接管（适合在对方插件 `onunload` 中调用）；幂等。 */
    releaseAll(caller: ExternalCaller): ExternalReleaseResult;
    /** 查询单个功能的当前状态。 */
    getFeatureState(featureId: string): Promise<ExternalFeatureState>;
    /** 列出当前宿主上所有允许外部控制的功能及其状态。 */
    listControllableFeatures(): Promise<ExternalFeatureState[]>;
}

/** 供设置面板使用的功能外部状态视图。 */
export interface FeatureExternalView {
    takenOver: boolean;
    takeovers: ExternalTakeoverInfo[];
    notice?: ExternalNoticeInfo;
}

/** `window` 上派发的就绪事件载荷。 */
export interface ExternalApiReadyDetail {
    pluginName: string;
    version: number;
    api: SomeSettingsPublicApi;
}

/** `window` 上派发的卸载事件载荷。 */
export interface ExternalApiUnloadDetail {
    pluginName: string;
    version: number;
}

interface InternalTakeover extends ExternalTakeoverInfo {
    /** 注册时是否在宿主 `app.plugins` 中见过该插件，用于卸载后自动兜底清理。 */
    observedInHost: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isReadonlyHost = (): boolean =>
    typeof window !== "undefined" && Boolean(window.siyuan?.config?.readonly || window.siyuan?.isPublish);

const currentHostLang = (): string => {
    if (typeof window === "undefined") {
        return "en";
    }
    const config = window.siyuan?.config as {lang?: string; appearance?: {lang?: string;};} | undefined;
    return config?.lang || config?.appearance?.lang || "en";
};

/** 把 `zh_CN` 与 `zh-CN` 统一成小写连字符形式，便于跨写法匹配界面语言。 */
const normalizeLang = (lang: string): string => lang.trim().replace(/_/g, "-").toLowerCase();

/** 清洗可选补充原因：保留非空字符串或只含非空字符串的语言映射，非法值直接丢弃。 */
export const sanitizeReason = (reason: unknown): LocalizedReason | undefined => {
    if (typeof reason === "string") {
        const trimmed = reason.trim();
        return trimmed ? trimmed : undefined;
    }
    if (!isPlainObject(reason)) {
        return undefined;
    }
    const cleaned: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(reason)) {
        const lang = key.trim();
        if (!lang || typeof value !== "string") {
            continue;
        }
        const text = value.trim();
        if (!text) {
            continue;
        }
        cleaned[lang] = text;
        count += 1;
    }
    return count > 0 ? cleaned : undefined;
};

/** 克隆 `LocalizedReason`，防止调用方后续修改原对象污染内部状态。 */
const cloneReason = (reason: LocalizedReason | undefined): LocalizedReason | undefined => {
    if (typeof reason === "string" || reason === undefined) {
        return reason;
    }
    return {...reason};
};

/** 按当前思源界面语言解析可选补充原因。 */
export const resolveLocalizedReason = (
    reason: LocalizedReason | undefined,
    lang: string = currentHostLang(),
): string | undefined => {
    if (reason === undefined) {
        return undefined;
    }
    if (typeof reason === "string") {
        const trimmed = reason.trim();
        return trimmed || undefined;
    }
    const entries = Object.entries(reason)
        .filter(([, value]) => typeof value === "string" && value.trim() !== "")
        .map(([key, value]) => ({raw: key, normalized: normalizeLang(key), text: (value as string).trim()}));
    if (entries.length === 0) {
        return undefined;
    }
    const target = normalizeLang(lang || "en");
    const exact = entries.find((entry) => entry.normalized === target);
    if (exact) {
        return exact.text;
    }
    const prefix = target.split("-")[0];
    if (prefix) {
        const byPrefix = entries.find((entry) =>
            entry.normalized === prefix || entry.normalized.startsWith(`${prefix}-`)
        );
        if (byPrefix) {
            return byPrefix.text;
        }
    }
    const fallback = entries.find((entry) => entry.normalized === "default") ??
        entries.find((entry) => entry.normalized === "en") ??
        entries[0];
    return fallback?.text;
};

/** 从 `ExternalCaller` 提取并校验插件名与可选展示名。 */
const parseCaller = (caller: unknown): {name: string; displayName?: string;} | undefined => {
    if (typeof caller === "string") {
        const name = caller.trim();
        return name ? {name} : undefined;
    }
    if (!isPlainObject(caller) || typeof caller.name !== "string") {
        return undefined;
    }
    const name = caller.name.trim();
    if (!name) {
        return undefined;
    }
    const displayName = typeof caller.displayName === "string" && caller.displayName.trim() ?
        caller.displayName.trim() :
        undefined;
    return {name, displayName};
};

/**
 * 解析一个功能的主控开关字段。
 *
 * 与设置面板的判定完全同源：
 * - 常规功能是 `kind: "switch", key: "enabled"`；
 * - 声明了 `isEnabled` 的功能拿第一个 `select` 当开关（前提是该 select 有默认关闭值且有选项）。
 * 纯动作项与说明项（如 `clear-config`、`plugin-reminder`）返回 `undefined`。
 */
export const resolveFeatureSwitch = (definition: FeatureDefinition): FeatureSwitchInfo | undefined => {
    const toggle = definition.settings.find(
        (field): field is Extract<SettingField, {kind: "switch";}> =>
            field.kind === "switch" && field.key === "enabled",
    );
    if (toggle) {
        return {
            key: toggle.key,
            kind: "switch",
            offValue: false,
        };
    }
    if (!definition.isEnabled) {
        return undefined;
    }
    const select = definition.settings.find(
        (field): field is Extract<SettingField, {kind: "select";}> => field.kind === "select",
    );
    if (!select) {
        return undefined;
    }
    const options = select.options?.map((option) => option.value);
    return {
        key: select.key,
        kind: "select",
        options,
        offValue: select.default,
    };
};

/** 判断某个功能此刻是否处于启用状态，与 `core/bootstrap.ts` 保持同一套规则。 */
const isFeatureEnabled = (definition: FeatureDefinition, config: FeatureConfig): boolean =>
    definition.isEnabled ? definition.isEnabled(config) : config.enabled === true;

/** 查找宿主已加载插件列表中的目标插件实例。 */
const hostPluginsOf = (plugin: Plugin): Plugin[] => {
    const fromPlugin = (plugin as unknown as {app?: {plugins?: Plugin[];};}).app?.plugins;
    if (Array.isArray(fromPlugin)) {
        return fromPlugin;
    }
    const fromWindow = typeof window !== "undefined" ? window.siyuan?.ws?.app?.plugins : undefined;
    return Array.isArray(fromWindow) ? fromWindow : [];
};

const findHostPlugin = (plugin: Plugin, name: string): Plugin | undefined =>
    hostPluginsOf(plugin).find((item) => item?.name === name);

/** 解析一个外部插件在当前界面下要展示的名称：优先实时取宿主插件的 `displayName`。 */
export const resolveCallerDisplayName = (
    plugin: Plugin,
    caller: string,
    fallbackDisplayName?: string,
): string => {
    const live = findHostPlugin(plugin, caller);
    if (typeof live?.displayName === "string" && live.displayName.trim()) {
        return live.displayName.trim();
    }
    if (typeof fallbackDisplayName === "string" && fallbackDisplayName.trim()) {
        return fallbackDisplayName.trim();
    }
    return caller;
};

/** 解析并校验一次外部请求里的目标字段值。 */
const resolveTargetValue = (
    switchField: FeatureSwitchInfo,
    requested: boolean | string,
): {ok: true; value: boolean | string;} | {ok: false; message: string;} => {
    if (switchField.kind === "switch") {
        if (typeof requested !== "boolean") {
            return {ok: false, message: `feature switch "${switchField.key}" requires a boolean value`};
        }
        return {ok: true, value: requested};
    }
    // 下拉型开关：传 `false` 统一映射到该功能的默认关闭值
    if (requested === false) {
        return {ok: true, value: switchField.offValue};
    }
    if (requested === true) {
        const enabledOptions = (switchField.options ?? []).filter((option) => option !== switchField.offValue);
        if (enabledOptions.length === 1) {
            return {ok: true, value: enabledOptions[0]};
        }
        return {
            ok: false,
            message: enabledOptions.length > 0 ?
                `select switch "${switchField.key}" requires an explicit option value: ${enabledOptions.join(" / ")}` :
                `select switch "${switchField.key}" requires an explicit string option value`,
        };
    }
    if (typeof requested !== "string" || !requested) {
        return {ok: false, message: `select switch "${switchField.key}" requires a string value or false`};
    }
    if (switchField.options && !switchField.options.includes(requested)) {
        return {
            ok: false,
            message: `"${requested}" is not a valid option for "${switchField.key}" (expected ${
                switchField.options.join(" / ")
            })`,
        };
    }
    return {ok: true, value: requested};
};

/** 检查一个功能是否允许被外部控制；返回不可控原因或解析好的定义与开关。 */
const inspectControllability = (
    featureId: string,
): {
    ok: true;
    definition: FeatureDefinition;
    switchField: FeatureSwitchInfo;
} | {
    ok: false;
    code: "invalid-feature" | "protected" | "unavailable" | "no-switch";
    message: string;
    definition?: FeatureDefinition;
    switchField?: FeatureSwitchInfo;
} => {
    const id = typeof featureId === "string" ? featureId.trim() : "";
    const definition = id ? featureById(id) : undefined;
    if (!definition) {
        return {ok: false, code: "invalid-feature", message: `unknown feature "${featureId}"`};
    }
    if (definition.category.includes("plugin")) {
        return {
            ok: false,
            code: "protected",
            message: `feature "${definition.id}" belongs to the protected "plugin" category`,
            definition,
            switchField: resolveFeatureSwitch(definition),
        };
    }
    const reasons = unavailableReasons(definition);
    if (reasons.length > 0) {
        return {
            ok: false,
            code: "unavailable",
            message: `feature "${definition.id}" is unavailable on this host (${reasons.join(", ")})`,
            definition,
            switchField: resolveFeatureSwitch(definition),
        };
    }
    const switchField = resolveFeatureSwitch(definition);
    if (!switchField) {
        return {
            ok: false,
            code: "no-switch",
            message: `feature "${definition.id}" has no switch to control`,
            definition,
        };
    }
    return {ok: true, definition, switchField};
};

/** 校验写回的 `external-notices` 文件内容是否与写入值一致。 */
const noticesMatch = (written: Record<string, ExternalNoticeInfo>, readBack: unknown): boolean => {
    if (!isPlainObject(readBack)) {
        return false;
    }
    const writtenKeys = Object.keys(written);
    const actualKeys = Object.keys(readBack);
    if (writtenKeys.length !== actualKeys.length) {
        return false;
    }
    return writtenKeys.every((key) => JSON.stringify(readBack[key]) === JSON.stringify(written[key]));
};

/** 从磁盘原始 JSON 归一化非接管提示映射，非法条目告警并跳过。 */
const normalizeStoredNotices = (raw: unknown): Map<string, ExternalNoticeInfo> => {
    const result = new Map<string, ExternalNoticeInfo>();
    if (!isPlainObject(raw)) {
        if (raw !== null && raw !== undefined) {
            log.warn(`${EXTERNAL_NOTICES_STORAGE} does not hold an object, ignoring it`);
        }
        return result;
    }
    for (const [featureId, entry] of Object.entries(raw)) {
        if (!isPlainObject(entry)) {
            log.warn(`${EXTERNAL_NOTICES_STORAGE}: skipping invalid entry for "${featureId}"`);
            continue;
        }
        const caller = typeof entry.caller === "string" ? entry.caller.trim() : "";
        const key = typeof entry.key === "string" ? entry.key.trim() : "";
        const value = entry.value;
        if (!caller || !key || (typeof value !== "boolean" && typeof value !== "string")) {
            log.warn(`${EXTERNAL_NOTICES_STORAGE}: skipping malformed notice for "${featureId}"`);
            continue;
        }
        const displayName = typeof entry.displayName === "string" && entry.displayName.trim() ?
            entry.displayName.trim() :
            undefined;
        const reason = sanitizeReason(entry.reason);
        const updatedAt = typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ?
            entry.updatedAt :
            0;
        result.set(featureId, {
            caller,
            ...(displayName ? {displayName} : {}),
            key,
            value,
            ...(reason !== undefined ? {reason} : {}),
            updatedAt,
        });
    }
    return result;
};

/**
 * 外部控制核心管理器。
 *
 * 持有运行时接管表（内存态）、非接管提示表（持久化到 `external-notices`）以及
 * 面向面板的状态订阅；由 `FeatureManager` 创建并随插件生命周期启停。
 */
export class ExternalControlManager {
    private readonly plugin: Plugin;
    private readonly store: ConfigStore;
    private readonly readyPromise: Promise<void>;
    private readonly takeovers = new Map<string, InternalTakeover[]>();
    private readonly notices = new Map<string, ExternalNoticeInfo>();
    private readonly listeners = new Set<(featureId: string) => void>();
    private readonly featureQueues = new Map<string, Promise<unknown>>();
    private noticeWriteQueue: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(plugin: Plugin, store: ConfigStore, readyPromise: Promise<void>) {
        this.plugin = plugin;
        this.store = store;
        this.readyPromise = readyPromise;
    }

    /** 启动阶段从插件私有存储加载持久化的非接管黄色提示。 */
    async loadNotices(): Promise<void> {
        const stored = await readStoredFile(this.plugin, EXTERNAL_NOTICES_STORAGE);
        if (this.disposed) {
            return;
        }
        this.notices.clear();
        const loaded = normalizeStoredNotices(stored);
        loaded.forEach((notice, featureId) => this.notices.set(featureId, notice));
        log.info(`loaded ${this.notices.size} persisted external notice(s)`, [...this.notices.keys()]);
    }

    /** 订阅外部接管 / 提示状态变化（传入变更的 `featureId`，批量变化传 `"*"`）。 */
    subscribe(listener: (featureId: string) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(featureId: string): void {
        this.listeners.forEach((listener) => listener(featureId));
    }

    /**
     * 清理已经不在宿主 `app.plugins` 里的接管方（防止外部插件忘记在 `onunload` 释放而永久锁死）。
     *
     * 只清理「注册时确实在 `app.plugins` 中见过、现在已不在其中」的条目：
     * 正常思源插件在 `onload` 前就已加入 `app.plugins`，卸载时会从数组移除；
     * 不在 `app.plugins` 中的合成调用方则不受影响。
     */
    pruneStaleTakeovers(): string[] {
        const affected: string[] = [];
        for (const [featureId, list] of this.takeovers.entries()) {
            const kept: InternalTakeover[] = [];
            const removed: string[] = [];
            for (const entry of list) {
                if (entry.observedInHost && !findHostPlugin(this.plugin, entry.caller)) {
                    removed.push(entry.caller);
                } else {
                    kept.push(entry);
                }
            }
            if (removed.length === 0) {
                continue;
            }
            if (kept.length > 0) {
                this.takeovers.set(featureId, kept);
            } else {
                this.takeovers.delete(featureId);
            }
            affected.push(featureId);
            log.info(`pruned stale takeover(s) on ${featureId} for unloaded caller(s)`, removed);
        }
        affected.forEach((featureId) => this.notify(featureId));
        return affected;
    }

    /** 某个功能此刻是否正被外部插件接管。 */
    isTakenOver(featureId: string): boolean {
        return (this.takeovers.get(featureId)?.length ?? 0) > 0;
    }

    /** 读取某个功能在设置面板里需要呈现的外部接管 / 提示状态快照。 */
    viewOf(featureId: string): FeatureExternalView {
        const takeovers = (this.takeovers.get(featureId) ?? []).map((entry) => ({
            caller: entry.caller,
            ...(entry.displayName ? {displayName: entry.displayName} : {}),
            key: entry.key,
            value: entry.value,
            ...(entry.reason !== undefined ? {reason: cloneReason(entry.reason)} : {}),
        }));
        const notice = this.notices.get(featureId);
        return {
            takenOver: takeovers.length > 0,
            takeovers,
            ...(notice ?
                {
                    notice: {
                        ...notice,
                        ...(notice.reason !== undefined ? {reason: cloneReason(notice.reason)} : {}),
                    },
                } :
                {}),
        };
    }

    /** 用户在面板中编辑了该功能设置后，清除对应的非接管黄色提示并落盘。 */
    async clearNotice(featureId: string): Promise<void> {
        if (!this.notices.has(featureId)) {
            return;
        }
        this.notices.delete(featureId);
        log.info(`cleared external notice for ${featureId} after user edit`);
        this.notify(featureId);
        await this.persistNotices();
    }

    /** 清空全部配置或导入整套配置后，清除所有持久化的非接管黄色提示（含可能残留在磁盘的旧文件）。 */
    async clearAllNotices(): Promise<void> {
        const ids = [...this.notices.keys()];
        this.notices.clear();
        if (ids.length > 0) {
            log.info(`cleared all ${ids.length} persisted external notice(s)`, ids);
            this.notify("*");
        }
        await this.persistNotices();
    }

    /** 生成挂在 `plugin.api` 上的公开只读接口对象。 */
    createPublicApi(): SomeSettingsPublicApi {
        return {
            version: EXTERNAL_API_VERSION,
            pluginName: this.plugin.name,
            ready: () => this.readyPromise,
            setFeature: (request) => this.setFeature(request),
            disableFeature: (caller, featureId, options) =>
                this.setFeature({
                    caller,
                    featureId,
                    enabled: false,
                    takeover: options?.takeover,
                    reason: options?.reason,
                }),
            enableFeature: (caller, featureId, options) =>
                this.setFeature({
                    caller,
                    featureId,
                    enabled: options?.value ?? true,
                    takeover: options?.takeover,
                    reason: options?.reason,
                }),
            release: (caller, featureId) => this.release(caller, featureId),
            releaseAll: (caller) => this.releaseAll(caller),
            getFeatureState: (featureId) => this.getFeatureState(featureId),
            listControllableFeatures: () => this.listControllableFeatures(),
        };
    }

    /** 开启、关闭或接管一个功能；同一功能的并发调用按顺序串行，避免竞态绕过冲突检查。 */
    async setFeature(request: ExternalControlRequest): Promise<ExternalControlResult> {
        const parsedAtCall = parseCaller(request?.caller);
        // 在任何 await 之前先记录调用方此刻是否在宿主 app.plugins 中，
        // 避免对方在等待 readyPromise / 排队 / 写盘途中被卸载却被误判为「合成调用方」。
        const observedAtCall = Boolean(parsedAtCall && findHostPlugin(this.plugin, parsedAtCall.name));
        await this.readyPromise;
        const featureId = typeof request?.featureId === "string" ? request.featureId.trim() : "";
        if (this.disposed) {
            log.warn(`rejected setFeature on "${featureId}": plugin has been unloaded`);
            return {ok: false, featureId, code: "disposed", message: "plugin has been unloaded"};
        }
        const caller = parsedAtCall;
        if (!caller) {
            log.warn("rejected setFeature call: invalid caller", {featureId});
            return {
                ok: false,
                featureId,
                code: "invalid-caller",
                message: "caller must be a non-empty plugin name or Plugin instance",
            };
        }
        return this.enqueueFeature(
            featureId || "__invalid__",
            () => this.runSetFeature(caller, featureId, request, observedAtCall),
        );
    }

    private async runSetFeature(
        caller: {name: string; displayName?: string;},
        featureId: string,
        request: ExternalControlRequest,
        observedAtCall: boolean,
    ): Promise<ExternalControlResult> {
        if (this.disposed) {
            log.warn(`rejected setFeature from ${caller.name} on "${featureId}": plugin has been unloaded`);
            return {ok: false, featureId, code: "disposed", message: "plugin has been unloaded"};
        }
        const check = inspectControllability(featureId);
        if ("code" in check) {
            log.warn(`rejected setFeature from ${caller.name} on "${featureId}": ${check.code}`);
            return {ok: false, featureId, code: check.code, message: check.message};
        }
        const {definition, switchField} = check;
        const target = resolveTargetValue(switchField, request.enabled);
        if ("message" in target) {
            log.warn(`rejected setFeature from ${caller.name} on "${definition.id}": ${target.message}`);
            return {ok: false, featureId: definition.id, code: "invalid-value", message: target.message};
        }
        if (isReadonlyHost()) {
            log.warn(`rejected setFeature from ${caller.name} on "${definition.id}": host is readonly or publish`);
            return {
                ok: false,
                featureId: definition.id,
                code: "readonly",
                message: "SiYuan is in read-only or publish mode, so settings cannot be modified",
            };
        }

        // 先清掉已卸载插件遗留的接管，再做冲突裁决
        this.pruneStaleTakeovers();

        const takeover = request.takeover === true;
        const existing = this.takeovers.get(definition.id) ?? [];
        const others = existing.filter((entry) => entry.caller !== caller.name);
        if (others.length > 0) {
            const holders = others.map((entry) => entry.caller);
            if (!takeover) {
                log.warn(`rejected non-takeover setFeature from ${caller.name} on ${definition.id}: held by`, holders);
                return {
                    ok: false,
                    featureId: definition.id,
                    code: "conflict",
                    message: `feature "${definition.id}" is currently taken over by ${holders.join(", ")}`,
                    holders,
                };
            }
            if (others[0].value !== target.value) {
                log.warn(
                    `rejected conflicting takeover from ${caller.name} on ${definition.id}: requested ${
                        JSON.stringify(target.value)
                    }, held as ${JSON.stringify(others[0].value)} by`,
                    holders,
                );
                return {
                    ok: false,
                    featureId: definition.id,
                    code: "conflict",
                    message: `feature "${definition.id}" is taken over with a conflicting value by ${
                        holders.join(", ")
                    }`,
                    holders,
                };
            }
        }

        // 写盘前先记录调用方此刻是否在宿主 app.plugins 中，用于检测写盘途中卸载的竞态
        const hostBefore = findHostPlugin(this.plugin, caller.name);
        const observedBefore = observedAtCall || Boolean(hostBefore);
        const currentConfig = this.store.get(definition.id);
        const previousValue = currentConfig[switchField.key];
        const changed = previousValue !== target.value;

        try {
            await this.store.patch(definition.id, {[switchField.key]: target.value});
        } catch (error) {
            log.error(`failed to write ${definition.id} for external caller ${caller.name}`, error);
            return {
                ok: false,
                featureId: definition.id,
                code: "write-failed",
                message: error instanceof Error ? error.message : String(error),
            };
        }

        if (this.disposed) {
            log.warn(`discarded setFeature from ${caller.name} on ${definition.id}: plugin unloaded during write`);
            return {ok: false, featureId: definition.id, code: "disposed", message: "plugin has been unloaded"};
        }

        // 若 ConfigStore 正处于清空 / 导入的独占锁期间，applyPatch 会静默丢弃改动；
        // 这里核对 store 最终值，避免状态与磁盘脱节。
        if (this.store.get(definition.id)[switchField.key] !== target.value) {
            log.error(
                `configuration patch on ${definition.id} for ${caller.name} did not take effect (bulk operation in progress)`,
            );
            return {
                ok: false,
                featureId: definition.id,
                code: "write-failed",
                message: "configuration change was dropped while a bulk configuration operation was running",
            };
        }

        const reason = sanitizeReason(request.reason);
        const liveHost = findHostPlugin(this.plugin, caller.name);
        const resolvedDisplayName = caller.displayName ??
            (typeof liveHost?.displayName === "string" && liveHost.displayName.trim() ?
                liveHost.displayName.trim() :
                typeof hostBefore?.displayName === "string" && hostBefore.displayName.trim() ?
                hostBefore.displayName.trim() :
                undefined);

        // 始终重新读取写盘完成后的接管列表，防止写盘期间已通过 release() 释放的接管方复活
        const latestExisting = this.takeovers.get(definition.id) ?? [];
        const latestOthers = latestExisting.filter((entry) => entry.caller !== caller.name);
        let activeTakeover = false;
        let shouldPersistNotices = false;
        if (takeover) {
            if (observedBefore && !liveHost) {
                // 调用方在异步写盘途中已被宿主卸载，不再挂接管锁，避免永久锁死
                log.info(`caller ${caller.name} unloaded while writing ${definition.id}, skipping takeover lock`);
            } else {
                const nextEntry: InternalTakeover = {
                    caller: caller.name,
                    ...(resolvedDisplayName ? {displayName: resolvedDisplayName} : {}),
                    key: switchField.key,
                    value: target.value,
                    ...(reason !== undefined ? {reason: cloneReason(reason)} : {}),
                    observedInHost: Boolean(liveHost),
                };
                const nextList = [...latestOthers, nextEntry];
                this.takeovers.set(definition.id, nextList);
                activeTakeover = true;
                // 若该调用方之前留过非接管提示，或者这次接管改变了配置值，清掉已过时的非接管提示
                const priorNotice = this.notices.get(definition.id);
                if (priorNotice && (priorNotice.caller === caller.name || changed)) {
                    this.notices.delete(definition.id);
                    shouldPersistNotices = true;
                }
                log.info(`external takeover applied on ${definition.id}`, {
                    caller: caller.name,
                    key: switchField.key,
                    value: target.value,
                    changed,
                    holders: nextList.map((item) => item.caller),
                });
            }
        } else {
            // 同一个调用方从接管降级为非接管时，释放它自己原先的接管锁
            if (latestExisting.some((entry) => entry.caller === caller.name)) {
                this.takeovers.delete(definition.id);
            }
            // 非接管模式仅在实际发生配置变更时记录并持久化黄色提示
            if (changed) {
                this.notices.set(definition.id, {
                    caller: caller.name,
                    ...(resolvedDisplayName ? {displayName: resolvedDisplayName} : {}),
                    key: switchField.key,
                    value: target.value,
                    ...(reason !== undefined ? {reason: cloneReason(reason)} : {}),
                    updatedAt: Date.now(),
                });
                shouldPersistNotices = true;
            }
            log.info(`external config change applied on ${definition.id}`, {
                caller: caller.name,
                key: switchField.key,
                value: target.value,
                changed,
                noticeRecorded: changed,
            });
        }

        if (shouldPersistNotices) {
            await this.persistNotices();
        }
        this.notify(definition.id);

        let releasedByHandle = false;
        const release = (): void => {
            if (!activeTakeover || releasedByHandle) {
                return;
            }
            releasedByHandle = true;
            this.release(caller.name, definition.id);
        };

        return {
            ok: true,
            featureId: definition.id,
            key: switchField.key,
            value: target.value,
            changed,
            takeover: activeTakeover,
            release,
        };
    }

    /** 释放指定调用方对指定功能的接管；幂等。 */
    release(callerInput: ExternalCaller, featureId: string): ExternalReleaseResult {
        const caller = parseCaller(callerInput);
        const id = typeof featureId === "string" ? featureId.trim() : "";
        if (!caller || !id) {
            return {released: 0, featureIds: []};
        }
        const list = this.takeovers.get(id);
        if (!list) {
            return {released: 0, featureIds: []};
        }
        const next = list.filter((entry) => entry.caller !== caller.name);
        const released = list.length - next.length;
        if (released === 0) {
            return {released: 0, featureIds: []};
        }
        if (next.length > 0) {
            this.takeovers.set(id, next);
        } else {
            this.takeovers.delete(id);
        }
        log.info(`released external takeover on ${id}`, {
            caller: caller.name,
            remainingHolders: next.map((entry) => entry.caller),
        });
        this.notify(id);
        return {released, featureIds: [id]};
    }

    /** 释放指定调用方持有的全部接管；幂等。 */
    releaseAll(callerInput: ExternalCaller): ExternalReleaseResult {
        const caller = parseCaller(callerInput);
        if (!caller) {
            return {released: 0, featureIds: []};
        }
        let released = 0;
        const featureIds: string[] = [];
        for (const [id, list] of this.takeovers.entries()) {
            const next = list.filter((entry) => entry.caller !== caller.name);
            const removed = list.length - next.length;
            if (removed === 0) {
                continue;
            }
            released += removed;
            featureIds.push(id);
            if (next.length > 0) {
                this.takeovers.set(id, next);
            } else {
                this.takeovers.delete(id);
            }
        }
        if (released > 0) {
            log.info(`released all ${released} external takeover(s) for ${caller.name}`, featureIds);
            featureIds.forEach((id) => this.notify(id));
        }
        return {released, featureIds};
    }

    /** 查询单个功能的当前对外只读状态。 */
    async getFeatureState(featureId: string): Promise<ExternalFeatureState> {
        await this.readyPromise;
        this.pruneStaleTakeovers();
        const id = typeof featureId === "string" ? featureId.trim() : "";
        const check = inspectControllability(id);
        if ("code" in check) {
            const exists = Boolean(check.definition);
            const available = exists && unavailableReasons(check.definition as FeatureDefinition).length === 0;
            return {
                featureId: check.definition?.id ?? id,
                exists,
                available,
                controllable: false,
                uncontrollableReason: check.code,
                ...(check.switchField ? {switchField: {...check.switchField}} : {}),
                takeovers: [],
            };
        }
        const {definition, switchField} = check;
        const config = this.store.get(definition.id);
        const rawValue = config[switchField.key];
        const value = typeof rawValue === "boolean" || typeof rawValue === "string" ? rawValue : switchField.offValue;
        const view = this.viewOf(definition.id);
        return {
            featureId: definition.id,
            exists: true,
            available: true,
            controllable: true,
            switchField: {
                ...switchField,
                ...(switchField.options ? {options: [...switchField.options]} : {}),
            },
            value,
            enabled: isFeatureEnabled(definition, config),
            takeovers: view.takeovers,
            ...(view.notice ? {notice: view.notice} : {}),
        };
    }

    /** 列出当前宿主上全部可被外部控制的功能状态。 */
    async listControllableFeatures(): Promise<ExternalFeatureState[]> {
        await this.readyPromise;
        this.pruneStaleTakeovers();
        const states: ExternalFeatureState[] = [];
        for (const definition of effectiveFeatures()) {
            const check = inspectControllability(definition.id);
            if ("code" in check) {
                continue;
            }
            const config = this.store.get(definition.id);
            const rawValue = config[check.switchField.key];
            const value = typeof rawValue === "boolean" || typeof rawValue === "string" ?
                rawValue :
                check.switchField.offValue;
            const view = this.viewOf(definition.id);
            states.push({
                featureId: definition.id,
                exists: true,
                available: true,
                controllable: true,
                switchField: {
                    ...check.switchField,
                    ...(check.switchField.options ? {options: [...check.switchField.options]} : {}),
                },
                value,
                enabled: isFeatureEnabled(definition, config),
                takeovers: view.takeovers,
                ...(view.notice ? {notice: view.notice} : {}),
            });
        }
        return states;
    }

    private enqueueFeature<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.featureQueues.get(key) ?? Promise.resolve();
        const next = previous.catch((): void => undefined).then(task);
        this.featureQueues.set(key, next);
        return next.finally(() => {
            if (this.featureQueues.get(key) === next) {
                this.featureQueues.delete(key);
            }
        });
    }

    /** 把非接管提示表序列化落盘并读回校验；全部清空时删除存储文件，不留空壳。 */
    private persistNotices(): Promise<void> {
        const task = this.noticeWriteQueue.catch((): void => undefined).then(async () => {
            if (this.disposed || isReadonlyHost()) {
                return;
            }
            if (this.notices.size === 0) {
                const status = await removeStoredFile(this.plugin, EXTERNAL_NOTICES_STORAGE);
                if (!status.ok) {
                    log.error(`failed to remove ${EXTERNAL_NOTICES_STORAGE}: ${status.detail}`);
                } else {
                    log.info(`removed ${EXTERNAL_NOTICES_STORAGE}`);
                }
                return;
            }
            const payload: Record<string, ExternalNoticeInfo> = {};
            this.notices.forEach((notice, featureId) => {
                payload[featureId] = {
                    ...notice,
                    ...(notice.reason !== undefined ? {reason: cloneReason(notice.reason)} : {}),
                };
            });
            const status = await writeStoredFile(this.plugin, EXTERNAL_NOTICES_STORAGE, payload);
            if (!status.ok) {
                log.error(`failed to write ${EXTERNAL_NOTICES_STORAGE}: ${status.detail}`);
                return;
            }
            const readBack = await readStoredFile(this.plugin, EXTERNAL_NOTICES_STORAGE);
            if (!noticesMatch(payload, readBack)) {
                log.error(`${EXTERNAL_NOTICES_STORAGE} read back mismatch after write`, {written: payload, readBack});
                return;
            }
            log.info(`${EXTERNAL_NOTICES_STORAGE} written and read back consistently`, Object.keys(payload));
        });
        this.noticeWriteQueue = task;
        return task;
    }

    /** 插件卸载时收尾：释放内存态接管与订阅（持久化提示文件保留）。 */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const count = this.takeovers.size;
        this.takeovers.clear();
        this.listeners.clear();
        log.info(`disposed external control manager (cleared ${count} feature takeover group(s))`);
    }
}
