/**
 * 设置项的可用性。
 *
 * 功能声明里的 `enabled`、`frontends` 与 `minAppVersion` / `maxAppVersion` 决定一个功能
 * 在当前这台思源上还能不能用；装载器据此决定加不加载、挂不挂载，设置面板据此把不可用的
 * 那部分灰显出来并注明原因（用户可以在「插件自身」页签里打开「显示不可用的设置」）。
 *
 * 判定只有这一处：`activeFeatures()`（registry）就是「没有原因」的那批功能，设置面板读的是同一个
 * 函数，不会出现「面板里说不可用、装载器却挂上了」这种两边不一致的状态。
 *
 * 「显示不可用的设置」本身也是一个功能（`src/features/show-unavailable-settings/`）：
 * 开关代表「这个功能做不做」，所以面板读的是它**挂载时**翻起来的那个标记，
 * 而不是自己去翻配置文件 —— 与「详细日志输出」读 `core/log.ts` 的标记是同一个做法。
 */
import {supportsCurrentFrontend} from "./frontend";
import type {FeatureDefinition} from "./types";
import {hostRangeProblem} from "./version";

/**
 * 「显示不可用的设置」功能的 id。
 *
 * 必须与 `src/features/show-unavailable-settings/` 目录名、那里声明的 id 一致：
 * 面板靠它订阅这个功能的配置变化，开关一翻就把不可用的行显隐掉。
 */
export const SHOW_UNAVAILABLE_FEATURE_ID = "show-unavailable-settings";

/**
 * 一个功能不可用的原因。
 *
 * - `disabled`：开发者把它从插件里撤下了（声明 `enabled: false`）
 * - `frontend`：只在另一端存在（例如移动端专有功能出现在桌面端）
 * - `minAppVersion`：宿主版本低于它声明的下限
 * - `maxAppVersion`：宿主版本高于它声明的上限（上游已原生实现，这份补丁退役）
 */
export type UnavailableReason = "disabled" | "frontend" | "minAppVersion" | "maxAppVersion";

/**
 * 该功能此刻为什么不可用；可用时返回 undefined。
 *
 * 判定顺序即原因的重要程度：先看这个功能还要不要（`enabled: false`），再看当前这台设备
 * 有没有这块界面，最后才看版本区间 —— 一个被撤下的功能，版本对不对都不再重要。
 */
export const unavailableReason = (definition: FeatureDefinition): UnavailableReason | undefined => {
    if (!definition.enabled) {
        return "disabled";
    }
    if (!supportsCurrentFrontend(definition)) {
        return "frontend";
    }
    return hostRangeProblem(definition);
};

/** 面板此刻要不要显示不可用的设置；由「显示不可用的设置」功能挂载 / 卸载时翻转。 */
let showingUnavailable = false;

/** 打开 / 关闭「显示不可用的设置」。只由那个功能调用 —— 挂载即打开、卸载即关闭。 */
export const setShowUnavailable = (value: boolean): void => {
    showingUnavailable = value;
};

/** 「显示不可用的设置」此刻是否打开。 */
export const isShowUnavailable = (): boolean => showingUnavailable;
