/**
 * 分级日志。
 *
 * 插件默认**不输出**任何详细日志：控制台里只留加载完成时那一行提示。
 * 想排查问题时到「设置 → 集市 → 已下载 → 本插件 → 设置」的「插件自身」页签里
 * 打开「详细日志输出」，之后所有模块的详细日志都会打到控制台；关掉即恢复安静。
 * 开关本身是一个功能（`src/features/log-output/`），挂载即打开、卸载即关闭。
 *
 * 约定：
 * - 每条日志的头部固定是 `[some-settings-siyuan__<scope>]`，scope 是功能 id；
 *   核心机制用 `core` / `core.<模块>`，一眼能看出是谁在说话。
 * - 级别只有 INFO / WARN / ERROR，分别走 console.log / warn / error。
 * - 详细日志一律用英文：它们面向排查问题的开发者，不维护两套语言。
 * - 一次调用只产出一条记录；参数拼成可读文本，方便复制、筛选与移动端的日志查看器。
 *   WARN / ERROR 里的错误会带上堆栈，正文占多行，但头部仍只在第一行。
 */
export const LOG_PREFIX = "some-settings-siyuan";

/**
 * 控制详细日志的那个功能的 id。
 *
 * 它必须与 `src/features/log-output/` 目录名、以及那里声明的 id 一致：
 * 功能装载器要先把它的开关装上，后面所有日志才可能落地；注册表里它也必须是第一个。
 * `tests/core/registry.test.ts` 守着这两条对应关系。
 */
export const LOG_FEATURE_ID = "log-output";

/** 日志级别。顺序即严重程度，写进每一行的级别标记。 */
export type LogLevel = "INFO" | "WARN" | "ERROR";

/** 一个模块 / 功能拿到的日志器。 */
export interface Logger {
    readonly scope: string;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

/**
 * 详细日志总开关。
 *
 * 放在模块作用域而不是某个实例上：功能装载器、配置存储、设置面板都在
 * 「日志输出」功能挂载之前就已经在跑，它们必须共用同一个开关。
 */
let detailed = false;

/** 详细日志此刻是否打开。 */
export const isDetailedLogging = (): boolean => detailed;

/**
 * 打开 / 关闭详细日志。
 *
 * 只由「日志输出」功能调用 —— 它挂载时打开、卸载时关闭，和面板上的开关是同一件事。
 */
export const setDetailedLogging = (enabled: boolean): void => {
    detailed = enabled;
};

/** 一行日志的头部：`[some-settings-siyuan__<scope>]`。 */
export const logTag = (scope: string): string => `[${LOG_PREFIX}__${scope}]`;

/**
 * 把一个参数变成一行里的可读文本。
 *
 * 对象走 JSON，其余交给 `String` —— 日志是给人看的，不需要保留对象引用。
 * 错误在 WARN / ERROR 里连同堆栈一起写出来：排查问题最需要的就是堆栈，
 * 而只写 `name: message` 会让「改之前能在控制台展开、改之后看不到」成为倒退。
 * 堆栈自带换行，所以一条错误日志会占多行，但头部只有第一行有，筛选不受影响。
 */
const describe = (value: unknown, withStack = false): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return withStack && typeof value.stack === "string" && value.stack ?
            value.stack :
            `${value.name}: ${value.message}`;
    }
    if (typeof value === "function") {
        return `[function ${value.name || "anonymous"}]`;
    }
    if (typeof value === "undefined") {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    if (typeof value === "symbol") {
        return value.toString();
    }
    try {
        const json = JSON.stringify(value);
        return typeof json === "string" ? json : String(value);
    } catch {
        return String(value);
    }
};

const write = (level: LogLevel, scope: string, args: unknown[]): void => {
    if (!detailed) {
        return;
    }
    const tail = args.length > 0 ? ` ${args.map((value) => describe(value, level !== "INFO")).join(" ")}` : "";
    const line = `${logTag(scope)} ${level}${tail}`;
    switch (level) {
        case "ERROR":
            console.error(line);
            break;
        case "WARN":
            console.warn(line);
            break;
        default:
            console.log(line);
            break;
    }
};

/** 简写：不需要复用日志器时直接按作用域打一条。 */
export const logInfo = (scope: string, ...args: unknown[]): void => write("INFO", scope, args);
export const logWarn = (scope: string, ...args: unknown[]): void => write("WARN", scope, args);
export const logError = (scope: string, ...args: unknown[]): void => write("ERROR", scope, args);

/** 造一个绑定作用域的日志器；功能宿主给每个功能的就是它。 */
export const createLogger = (scope: string): Logger => ({
    scope,
    info: (...args: unknown[]) => write("INFO", scope, args),
    warn: (...args: unknown[]) => write("WARN", scope, args),
    error: (...args: unknown[]) => write("ERROR", scope, args),
});

/**
 * 加载提示。
 *
 * 详细日志关着时，这是插件唯一会写进控制台的一行；文案来自 i18n，
 * 所以它随宿主语言变化，不参与「详细日志一律英文」的约定。
 * 它不受总开关影响，因此不走 `createLogger`。
 */
export const logLoaded = (message: string): void => {
    console.log(`${logTag("core")} ${message}`);
};
