/**
 * 用户级补丁：`data/storage/petal/<插件名>/.patch.yml`。
 *
 * 各功能的交付声明（`src/features/<id>/index.ts`）随插件代码一起发出去，用户想禁用某个功能、
 * 换个分类、限定适用前端或调整思源版本区间，只能改源码，升级后还会被覆盖回来；界面文案也只能
 * 改语言文件，同样随插件升级被覆盖。这里读一份用户自己维护的文件，在装载之前按功能 id 覆盖
 * 那五个声明字段，并按当前界面语言覆盖宿主已经加载的那份文案，其余声明与文案一律不动。
 *
 * 几条硬约束（与 issue #127 一致）：
 * - **整份生效或整份作废。** 任何一处语法 / 结构 / 取值问题都让整份补丁不生效，绝不留下
 *   「一半功能套用了补丁」的中间状态 —— 那种状态没人能一眼看出来。
 * - **声明只覆盖那五个字段。** `settings`、`mount`、功能名与说明都不能改；文案只能改
 *   宿主已加载语言文件里已有的键，值原样替换，`{…}` 占位符仍由用它的代码去填。
 * - **这里是声明层，不是运行开关。** 补丁关掉一个功能等于开发者没交出它：不读配置、不挂载、
 *   不进面板；被它重新打开的功能照旧受自己那个开关约束。
 * - **完全不碰源码里的对象。** 结果是一份新的声明视图（见 `core/registry.ts` 的
 *   `effectiveFeatures()`），存在任何错误就整份退回源码声明。
 * - **不写文件。** 补丁由用户自己创建与维护，插件不生成模板、不改内容、不监听变化。
 */
import type {Plugin} from "siyuan";
import {createLogger} from "./log";
import type {
    FeatureCategory,
    FeatureDefinition,
    FeatureFrontend,
    FeaturePatch,
} from "./types";
import {FEATURE_CATEGORIES} from "./types";
import {
    compareVersion,
    parseVersion,
} from "./version";
import type {
    YamlMapping,
    YamlValue,
} from "./yaml";
import {parseYaml} from "./yaml";

const log = createLogger("core.patch");

/** 补丁文件在插件私有存储目录里的文件名。 */
export const PATCH_STORAGE_NAME = ".patch.yml";

/** 补丁里允许出现的功能字段；其余一律视为非法。 */
const ALLOWED_FIELDS = ["enabled", "category", "frontends", "minAppVersion", "maxAppVersion"];

/** 补丁的顶层段：功能声明与界面文案。 */
const FEATURES_KEY = "features";
const I18N_KEY = "i18n";
const TOP_LEVEL_KEYS = [FEATURES_KEY, I18N_KEY];

const VALID_FRONTENDS: string[] = ["desktop", "mobile"];

/**
 * 应用补丁的结果。
 *
 * - `none`：没有补丁（文件不存在 / 空文件 / `features: {}`），行为与现状一致；
 * - `applied`：整份补丁生效，`features` 是完整的声明视图；
 * - `failed`：整份补丁作废，`detail` 是给人看的原因（不含文件内容）。
 */
export type PatchOutcome =
    | {kind: "none"; detail: string;}
    | {
        kind: "applied";
        features: FeatureDefinition[];
        /** 实际生效的功能覆盖条数。 */
        count: number;
        /** 实际生效的文案覆盖：键是 i18n key，值是替换后的整段文案。 */
        translations: Record<string, string>;
    }
    | {kind: "failed"; detail: string;};

/**
 * 补丁要改的那份界面文案。
 *
 * 宿主按界面语言只加载一份语言文件（`plugin.i18n`），补丁的语言段必须与它对上，
 * 键也只能是这份文件里已经有的 —— 加一个新键没有任何代码会用它。
 */
export interface PatchLocale {
    /** 当前界面语言，值形如 `en` / `zh-CN`。 */
    lang: string;
    /** 宿主已经加载的那份文案；拿不到时为空。 */
    messages: Record<string, unknown> | null | undefined;
}

/** 校验中途的失败：原因会进 WARN 日志与面板提示，所以只写「哪里不对」。 */
class PatchError extends Error {}

/**
 * 就地作废整份补丁。显式标成 `never`（变量本身带类型注解），
 * 这样调用点之后的类型收窄才成立：`if (!isMapping(value)) reject(...)` 之后 `value` 就是映射。
 */
const reject: (detail: string) => never = (detail) => {
    throw new PatchError(detail);
};

const isMapping = (value: YamlValue): value is YamlMapping =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** 一份补丁覆盖了哪些字段：`in` 判断，因为「写了 null」与「没写」是两件事。 */
const hasField = (patch: FeaturePatch, field: keyof FeaturePatch): boolean =>
    Object.prototype.hasOwnProperty.call(patch, field);

/**
 * `frontends` 的取值：`null` / 空值解除限制，数组里的每一项只能是 desktop / mobile 且不重复。
 *
 * 空数组是合法的，含义是「两端都不适用」—— 与省略字段（两端都适用）相反。
 */
const frontendsOf = (id: string, value: YamlValue): FeatureFrontend[] | null => {
    if (value === null) {
        return null;
    }
    if (!Array.isArray(value)) {
        reject(`feature "${id}": frontends must be a list such as [desktop, mobile], or null`);
    }
    const frontends: FeatureFrontend[] = [];
    value.forEach((item) => {
        if (typeof item !== "string" || !VALID_FRONTENDS.includes(item)) {
            reject(
                `feature "${id}": frontends may only contain desktop / mobile, but holds "${String(item)}"`,
            );
        }
        if (frontends.includes(item as FeatureFrontend)) {
            reject(`feature "${id}": frontends lists "${item}" twice`);
        }
        frontends.push(item as FeatureFrontend);
    });
    return frontends;
};

/** 版本边界：`null` / 空值解除限制，否则必须是本插件认得的思源版本号。 */
const versionOf = (id: string, field: string, value: YamlValue): string | null => {
    if (value === null) {
        return null;
    }
    if (typeof value !== "string" || !parseVersion(value)) {
        reject(`feature "${id}": ${field} must be a version such as "3.8.7", or null to remove the limit`);
    }
    return value as string;
};

/**
 * 一份功能条目的校验：只认那五个字段，逐项看取值。
 *
 * 校验放在这里而不是解析层，是因为「版本区间是否为空」要看补丁与源码声明合并后的结果。
 */
const patchOf = (id: string, value: YamlValue, definition: FeatureDefinition): FeaturePatch => {
    if (!isMapping(value)) {
        reject(`feature "${id}" must map its fields, but its entry is not a mapping`);
    }
    const patch: FeaturePatch = {};
    Object.keys(value).forEach((field) => {
        if (!ALLOWED_FIELDS.includes(field)) {
            reject(
                `feature "${id}" has an unknown field "${field}"; only ${ALLOWED_FIELDS.join(" / ")} can be patched`,
            );
        }
        const fieldValue = value[field];
        switch (field) {
            case "enabled":
                if (typeof fieldValue !== "boolean") {
                    reject(`feature "${id}": enabled must be true or false`);
                }
                patch.enabled = fieldValue as boolean;
                break;
            case "category":
                if (typeof fieldValue !== "string" || !(FEATURE_CATEGORIES as string[]).includes(fieldValue)) {
                    reject(
                        `feature "${id}": category must be one of ${FEATURE_CATEGORIES.join(" / ")}, but is "${
                            String(fieldValue)
                        }"`,
                    );
                }
                patch.category = fieldValue as FeatureCategory;
                break;
            case "frontends":
                patch.frontends = frontendsOf(id, fieldValue);
                break;
            case "minAppVersion":
            case "maxAppVersion":
                patch[field] = versionOf(id, field, fieldValue);
                break;
            default:
                break;
        }
    });
    // 合并后的区间不能是空的：只看补丁会把「源码下限已经高于补丁上限」放过去
    const min = hasField(patch, "minAppVersion") ? patch.minAppVersion : definition.minAppVersion;
    const max = hasField(patch, "maxAppVersion") ? patch.maxAppVersion : definition.maxAppVersion;
    const minimum = typeof min === "string" ? parseVersion(min) : undefined;
    const maximum = typeof max === "string" ? parseVersion(max) : undefined;
    if (minimum && maximum && compareVersion(minimum, maximum) > 0) {
        reject(`feature "${id}" would end up with minAppVersion "${min}" above maxAppVersion "${max}"`);
    }
    return patch;
};

/** 补丁里的 i18n 段：语言 → 键 → 文案。 */
export type TranslationSections = Record<string, Record<string, string>>;

/**
 * 读补丁的 `i18n` 段：只认「语言 → 键 → 字符串」这一种结构。
 *
 * 这里只看结构，「这个键到底存不存在」要等拿到宿主那份文案才能判断（见 `translationsOf()`）。
 * `i18n:` / `i18n: {}` / 某个语言后面什么都没写，都表示这一层没有覆盖。
 */
const i18nSectionsOf = (root: YamlMapping): TranslationSections => {
    const container = root[I18N_KEY];
    if (container === null || typeof container === "undefined") {
        return {};
    }
    if (!isMapping(container)) {
        reject(`"${I18N_KEY}" must map language codes to key/value pairs`);
    }
    const sections: TranslationSections = {};
    Object.keys(container).forEach((lang) => {
        const section = container[lang];
        if (section === null) {
            return;
        }
        if (!isMapping(section)) {
            reject(`i18n "${lang}" must map translation keys to texts`);
        }
        const messages: Record<string, string> = {};
        Object.keys(section).forEach((key) => {
            const value = section[key];
            if (typeof value !== "string") {
                reject(`i18n "${lang}": the value of "${key}" must be a string`);
            }
            messages[key] = value as string;
        });
        sections[lang] = messages;
    });
    return sections;
};

/**
 * 挑出当前界面语言那一节，并只保留宿主那份文案里已经有的键。
 *
 * 语言代码兼容两种写法：宿主用的 `zh-CN`，以及历史文件名的 `zh_CN`。只有当前语言那一节
 * 会生效 —— 宿主只加载一份语言文件，别的语言的翻译在运行期根本不存在。
 */
const translationsOf = (sections: TranslationSections, locale: PatchLocale): Record<string, string> => {
    const candidates = [locale.lang, locale.lang.replace(/-/g, "_")];
    const section = candidates.map((lang) => sections[lang]).find((value) => typeof value !== "undefined");
    if (!section) {
        return {};
    }
    const translations: Record<string, string> = {};
    Object.keys(section).forEach((key) => {
        if (typeof locale.messages?.[key] !== "string") {
            reject(`i18n "${locale.lang}": there is no such key as "${key}" in the loaded language file`);
        }
        translations[key] = section[key];
    });
    return translations;
};

/** 把整份补丁读成「功能 id → 覆盖值」；没有任何条目时返回空 Map。 */
const overridesOf = (
    root: YamlMapping,
    definitions: readonly FeatureDefinition[],
): Map<string, FeaturePatch> => {
    Object.keys(root).forEach((key) => {
        if (!TOP_LEVEL_KEYS.includes(key)) {
            reject(
                `unknown top-level key "${key}"; only ${
                    TOP_LEVEL_KEYS.map((name) => `"${name}"`).join(" / ")
                } can be patched`,
            );
        }
    });
    const container = root[FEATURES_KEY];
    // `features:` / `features: {}` / 整份文件只有注释：没有覆盖，属于正常状态
    if (container === null || typeof container === "undefined") {
        return new Map();
    }
    if (!isMapping(container)) {
        reject(`"${FEATURES_KEY}" must map feature ids to overrides`);
    }
    const overrides = new Map<string, FeaturePatch>();
    Object.keys(container).forEach((id) => {
        const definition = definitions.find((item) => item.id === id);
        if (!definition) {
            reject(`unknown feature id "${id}"`);
        }
        overrides.set(id, patchOf(id, container[id], definition));
    });
    return overrides;
};

/** 把一份覆盖值套到一个源码声明上，产出一条新的声明视图（源码对象不动）。 */
const patchedDefinition = (definition: FeatureDefinition, patch?: FeaturePatch): FeatureDefinition => {
    if (!patch) {
        return definition;
    }
    const patched: FeatureDefinition = {...definition};
    if (hasField(patch, "enabled")) {
        patched.enabled = patch.enabled === true;
        // 面板据此把原因写成「已被用户禁用」而不是「已被开发者禁用」
        patched.fromPatch = {...patched.fromPatch, enabled: patched.enabled};
    }
    if (hasField(patch, "category")) {
        patched.category = patch.category;
    }
    if (hasField(patch, "frontends")) {
        patched.frontends = patch.frontends === null ? undefined : patch.frontends;
    }
    if (hasField(patch, "minAppVersion")) {
        patched.minAppVersion = patch.minAppVersion === null ? undefined : patch.minAppVersion;
    }
    if (hasField(patch, "maxAppVersion")) {
        patched.maxAppVersion = patch.maxAppVersion === null ? undefined : patch.maxAppVersion;
    }
    return patched;
};

/**
 * 按补丁文本算出声明视图与文案覆盖。纯函数：不读盘、不写盘，测试直接喂文本。
 *
 * `definitions` 是源码声明（注册表里的那份），补丁只覆盖其中被点名的功能，
 * 其余条目原样引用 —— 它们从来没有被改过，不必复制。`locale` 是宿主此刻的界面语言与
 * 它加载的那份文案，i18n 段按它挑语言、按它认键。
 */
export const applyPatch = (
    definitions: readonly FeatureDefinition[],
    text: string,
    locale: PatchLocale,
): PatchOutcome => {
    const parsed = parseYaml(text);
    if (parsed.kind === "error") {
        return {kind: "failed", detail: parsed.detail};
    }
    try {
        const overrides = overridesOf(parsed.value, definitions);
        const translations = translationsOf(i18nSectionsOf(parsed.value), locale);
        if (overrides.size === 0 && Object.keys(translations).length === 0) {
            return {kind: "none", detail: "the patch overrides nothing"};
        }
        const features = definitions.map((definition) => patchedDefinition(definition, overrides.get(definition.id)));
        return {kind: "applied", features, count: overrides.size, translations};
    } catch (error) {
        return {
            kind: "failed",
            detail: error instanceof Error ? error.message : `cannot apply the patch: ${String(error)}`,
        };
    }
};

/**
 * 把一次补丁结局写进日志。
 *
 * 刻意与 `loadPatch()` 分开：详细日志默认关着，**读补丁的那一刻还没有任何功能被挂载**
 * （「日志输出」功能正是挂载时才打开详细日志），在那里打日志等于什么都不写 ——
 * 用户改错了文件却看不到原因，只能靠面板上那条提示。调用方要在「日志输出」挂载之后再调这里。
 *
 * 只写失败原因与（解析失败时的）行号，不回显文件内容：里面有用户自己的注释。
 */
export const reportPatch = (outcome: PatchOutcome): void => {
    if (outcome.kind === "applied") {
        log.info(
            `applied ${PATCH_STORAGE_NAME}: ${outcome.count} feature override(s), ${
                Object.keys(outcome.translations).length
            } translation(s)`,
        );
        return;
    }
    if (outcome.kind === "failed") {
        log.warn(`${PATCH_STORAGE_NAME} is invalid and is ignored for every feature: ${outcome.detail}`);
        return;
    }
    // 没有补丁是正常状态：只在详细日志里说明一句，不告警、不提示
    log.info(`no feature declaration is patched: ${outcome.detail}`);
};

/** 当前界面语言；拿不到宿主配置时按 en 处理（插件自带的兜底语言）。 */
const currentLanguage = (): string => {
    const lang = typeof window === "undefined" ? undefined : window.siyuan?.config?.lang;
    return typeof lang === "string" && lang !== "" ? lang : "en";
};

/**
 * 把补丁文案写回宿主那份 i18n 对象。
 *
 * `plugin.i18n` 是设置面板、动作行与各功能取文案的唯一来源，直接改它才能让补丁与
 * 「把这段文字写进 i18n/<lang>.json」完全等价 —— 包括 `{version}` 这类占位符：值原样替换，
 * 占位符仍由用它的代码去填。`plugin.i18n` 缺失时什么也不做。
 */
const applyTranslations = (plugin: Plugin, translations: Record<string, string>): void => {
    const messages = plugin.i18n;
    if (!messages || typeof messages !== "object") {
        return;
    }
    Object.keys(translations).forEach((key) => {
        messages[key] = translations[key];
    });
};

/**
 * 读补丁文件并算出声明视图。
 *
 * 读盘失败、内容不是文本、解析或校验失败，一律收敛成 `failed` 返回：补丁是用户主动加的高级入口，
 * 它出问题绝不能连累插件启动、设置入口或其他功能，调用方按「没有补丁」继续。
 */
export const loadPatch = async (
    plugin: Plugin,
    definitions: readonly FeatureDefinition[],
): Promise<PatchOutcome> => {
    let text: unknown;
    try {
        text = await plugin.loadData(PATCH_STORAGE_NAME);
    } catch (error) {
        return {kind: "failed", detail: `cannot read ${PATCH_STORAGE_NAME}: ${String(error)}`};
    }
    // 文件不存在时宿主兑现空串；兑现 undefined 说明这次读取失败并回落到空缓存，同样按「没有补丁」处理
    if (typeof text === "undefined" || text === null) {
        return {kind: "none", detail: `${PATCH_STORAGE_NAME} is missing`};
    }
    if (typeof text !== "string") {
        return {kind: "failed", detail: `${PATCH_STORAGE_NAME} must be plain text`};
    }
    if (text.trim() === "") {
        return {kind: "none", detail: `${PATCH_STORAGE_NAME} is empty`};
    }
    const outcome = applyPatch(definitions, text, {lang: currentLanguage(), messages: plugin.i18n});
    if (outcome.kind === "applied") {
        applyTranslations(plugin, outcome.translations);
    }
    return outcome;
};
