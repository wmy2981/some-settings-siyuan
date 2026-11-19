/**
 * 设置项的可用性。
 *
 * 功能声明里的 `enabled`、`frontends` 与 `minAppVersion` / `maxAppVersion` 决定一个功能
 * 在当前这台思源上还能不能用；装载器据此决定加不加载、挂不挂载，设置面板据此把不可用的
 * 那部分灰显出来并注明原因（用户可以在「插件自身」页签里打开「显示不可用的设置」）。
 *
 * 这四个字段都可以被用户级补丁覆盖（`core/patch.ts`）。判定读的是**应用补丁之后**的声明，
 * 所以这里不需要知道补丁的存在；唯一多出来的一层是「这个 `enabled: false` 是谁写的」，
 * 由声明视图上的来源标记区分（`FeatureDefinition.fromPatch`）。
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
 * - `userDisabled`：用户在 `.patch.yml` 里把它关掉了（`enabled: false`）
 * - `frontend`：只在另一端存在（例如移动端专有功能出现在桌面端），或者补丁把适用端设成了空
 * - `minAppVersion`：宿主版本低于它声明的下限
 * - `maxAppVersion`：宿主版本高于它声明的上限（上游已原生实现，这份补丁退役）
 */
export type UnavailableReason = "disabled" | "userDisabled" | "frontend" | "minAppVersion" | "maxAppVersion";

/**
 * 该功能此刻为什么不可用；可用时返回空数组。
 *
 * 一个功能可能同时命中多个原因（例如一个只在移动端存在、又已经超出最高版本的功能，
 * 在桌面端两条都成立），**命中的全部返回**，面板逐条列出来 —— 只挑一条会让人以为
 * 换个平台或换个版本就能用，而实际上另一条依然拦着它。
 *
 * 顺序固定为「功能还要不要 → 这台设备有没有这块界面 → 版本区间」，与原因的重要程度一致。
 */
export const unavailableReasons = (definition: FeatureDefinition): UnavailableReason[] => {
    const reasons: UnavailableReason[] = [];
    if (!definition.enabled) {
        // 两种「关掉」的后果完全一样（不装载、灰显），但原因要分清：用户改了自己的补丁，
        // 却看到「已被开发者禁用」，只会以为自己改错了地方
        reasons.push(definition.fromPatch?.enabled === false ? "userDisabled" : "disabled");
    }
    if (!supportsCurrentFrontend(definition)) {
        reasons.push("frontend");
    }
    // 版本区间只有一侧会不成立（min 高于 max 的声明由 npm run check 拦下），所以最多加一条
    const range = hostRangeProblem(definition);
    if (range) {
        reasons.push(range);
    }
    return reasons;
};

/** 面板此刻要不要显示不可用的设置；由「显示不可用的设置」功能挂载 / 卸载时翻转。 */
let showingUnavailable = false;

/** 打开 / 关闭「显示不可用的设置」。只由那个功能调用 —— 挂载即打开、卸载即关闭。 */
export const setShowUnavailable = (value: boolean): void => {
    showingUnavailable = value;
};

/** 「显示不可用的设置」此刻是否打开。 */
export const isShowUnavailable = (): boolean => showingUnavailable;
