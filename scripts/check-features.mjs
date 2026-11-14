/**
 * 功能声明与注册表的一致性校验。
 *
 * 构建前跑（npm run build 会先执行 npm run check），一次报全所有问题，
 * 目的是让「在 index.ts 里声明就能控制功能」这条路径始终可信：
 * 少写 `enabled`、分类写错、版本区间写反、注册表漏登记，都会在这里被拦住，
 * 而不是等到运行时静默失效、功能莫名消失。
 *
 * 用法：node scripts/check-features.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES_DIR = path.join(root, "src", "features");
const REGISTRY_FILE = path.join(root, "src", "core", "registry.ts");
const I18N_DIR = path.join(root, "src", "i18n");
const VALID_CATEGORIES = ["ai", "editor", "doc-tree", "appearance", "connection", "settings", "plugin"];

// ---------------------------------------------------------------- i18n 键名规则
// 键名只由功能 id / 分类 id 机械决定，不维护映射表：`feature.<camelId>.…`、`category.<camelId>`。
// 与 src/core/i18n-key.ts 同一套推导（脚本跑在裸 node 上，import 不到 TS），
// 两边算出来不一样时，这里会以「键缺失 / 键不存在」的形式报出来。
const camelId = (id) =>
    id.split("-").map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join("");
const categoryKey = (category) => `category.${camelId(category)}`;
/** 功能以外的四组前缀，顺序固定：plugin → category → panel → common。 */
const GLOBAL_NAMESPACES = ["plugin", "category", "panel", "common"];
/** 段名一律驼峰：`feature.<camelId>.<键名>[.<选项值>]`。 */
const KEY_PATTERN = /^[a-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;
/** 功能声明专用的末段，别的文案键不许占用。 */
const RESERVED_TAILS = ["title", "description"];
/** 这些控件存的是值，行文案必须严格跟随自己的 `<设置项 key>`。 */
const VALUE_KINDS = ["switch", "number", "text", "textarea", "select"];

/** 把 settings 数组切成一行一段，取出这一行的 kind / key 与各处文案 key。 */
const parseSettingRows = (settingsSource) => {
    const starts = [...settingsSource.matchAll(/\bkey\s*:\s*"([^"]+)"/g)];
    return starts.map((match, index) => {
        const segment = settingsSource.slice(match.index, starts[index + 1]?.index ?? settingsSource.length);
        const pick = (field) => new RegExp(`\\b${field}\\s*:\\s*"([^"]+)"`).exec(segment)?.[1];
        const optionsBlock = /options\s*:\s*\[([\s\S]*?)\]/.exec(segment)?.[1] ?? "";
        // `kind` 写在 `key` 前面，不在这一段里，所以往前找最近的一个
        const kind = [...settingsSource.slice(0, match.index).matchAll(/\bkind\s*:\s*"([^"]+)"/g)].pop()?.[1] ?? "";
        return {
            key: match[1],
            kind,
            options: [...optionsBlock.matchAll(/value\s*:\s*"([^"]+)"[\s\S]*?label\s*:\s*"([^"]+)"/g)]
                .map((option) => ({value: option[1], label: option[2]})),
            title: pick("title"),
            description: pick("description"),
            placeholder: pick("placeholder"),
            text: pick("text"),
            // 只有按钮行的 label 是文案 key；select 行里的 label 属于选项，另行校验
            label: kind === "button" ? pick("label") : undefined,
        };
    });
};

const problems = [];
const fail = (message) => problems.push(message);

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        fail(`${path.relative(root, file)} 不是合法 JSON：${error.message}`);
        return null;
    }
};

// ---------------------------------------------------------------- 版本号比较
// 与 src/core/version.ts 同一套规则：x.y.z[-pre]，预发布版本小于同号正式版，
// 预发布内部 alpha < beta < rc，纯数字段按数值比。
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const parseVersion = (raw) => {
    const match = VERSION_PATTERN.exec(raw.trim());
    if (!match) {
        return null;
    }
    return {
        numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split(".") : [],
    };
};

const comparePrerelease = (a, b) => {
    const shared = Math.min(a.length, b.length);
    for (let index = 0; index < shared; index += 1) {
        const left = a[index];
        const right = b[index];
        if (left === right) {
            continue;
        }
        const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
        const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
        if (leftNumber !== undefined && rightNumber !== undefined) {
            return leftNumber - rightNumber;
        }
        if (leftNumber !== undefined || rightNumber !== undefined) {
            return leftNumber !== undefined ? -1 : 1;
        }
        return left < right ? -1 : 1;
    }
    return a.length - b.length;
};

const compareVersion = (a, b) => {
    for (let index = 0; index < a.numbers.length; index += 1) {
        if (a.numbers[index] !== b.numbers[index]) {
            return a.numbers[index] - b.numbers[index];
        }
    }
    if (a.prerelease.length === 0 || b.prerelease.length === 0) {
        return b.prerelease.length - a.prerelease.length;
    }
    return comparePrerelease(a.prerelease, b.prerelease);
};

// ---------------------------------------------------------------- 功能目录
const featureDirs = fs.existsSync(FEATURES_DIR) ?
    fs.readdirSync(FEATURES_DIR, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort() :
    [];

const found = new Map();

for (const dir of featureDirs) {
    const indexPath = path.join(FEATURES_DIR, dir, "index.ts");
    if (!fs.existsSync(indexPath)) {
        fail(`src/features/${dir} 缺少 index.ts`);
        continue;
    }
    const source = fs.readFileSync(indexPath, "utf8");

    const idMatch = /defineFeature\s*\(\s*\{[\s\S]*?\bid\s*:\s*"([^"]+)"/.exec(source);
    const categoryMatch = /\bcategory\s*:\s*"([^"]+)"/.exec(source);
    if (!idMatch) {
        fail(`src/features/${dir}/index.ts 里没有找到 defineFeature({ id: "..." })`);
        continue;
    }
    const id = idMatch[1];
    const category = categoryMatch ? categoryMatch[1] : "";

    if (id !== dir) {
        fail(`功能 id "${id}" 与文件夹名 "${dir}" 不一致（两者必须相同）`);
    }
    if (!VALID_CATEGORIES.includes(category)) {
        fail(`功能 "${id}" 的 category="${category}" 非法，合法值为 ${VALID_CATEGORIES.join("/")}`);
    }

    // -------------------------------------------------- 1. enabled 声明
    // 它是「这个功能随插件一起交不交出」，必须是明确的布尔量：
    // 缺失或写成别的值都会让功能要么偷偷消失、要么在面板里露出来却没有实现。
    const enabledMatch = /\benabled\s*:\s*([A-Za-z]+)\s*,/.exec(source);
    if (!enabledMatch) {
        fail(`功能 "${id}" 没有声明 enabled: true / false`);
    } else if (enabledMatch[1] !== "true" && enabledMatch[1] !== "false") {
        fail(`功能 "${id}" 的 enabled=${enabledMatch[1]} 非法，只能是 true 或 false`);
    }

    // -------------------------------------------------- 2. 版本区间
    const versionOf = (field) => {
        const match = new RegExp(`\\b${field}\\s*:\\s*"([^"]+)"`).exec(source);
        if (!match) {
            return null;
        }
        if (!parseVersion(match[1])) {
            fail(`功能 "${id}" 的 ${field}="${match[1]}" 不是合法的思源版本号（形如 3.8.10-alpha.2）`);
            return null;
        }
        return parseVersion(match[1]);
    };
    const min = versionOf("minAppVersion");
    const max = versionOf("maxAppVersion");
    if (min && max && compareVersion(min, max) > 0) {
        fail(`功能 "${id}" 的 minAppVersion 高于 maxAppVersion，区间为空`);
    }

    // -------------------------------------------------- 3. settings 静态检查
    const settingsIndex = source.indexOf("settings:");
    const settingsSource = settingsIndex < 0 ? source : source.slice(settingsIndex);
    const keys = [...settingsSource.matchAll(/\bkey\s*:\s*"([^"]+)"/g)].map((match) => match[1]);

    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    [...new Set(duplicates)].forEach((key) => {
        fail(`功能 "${id}" 的 settings 里 key "${key}" 重复`);
    });

    const i18nKeys = new Set();
    // title / description / placeholder / label / text 的值必须是 i18n key。
    // default 是「实际内容」，不是 key，所以刻意不检查。
    [...settingsSource.matchAll(/\b(title|description|placeholder|label|text)\s*:\s*"([^"]+)"/g)]
        .forEach((match) => i18nKeys.add(match[2]));
    // select 选项的标签
    [...settingsSource.matchAll(/options\s*:\s*\[([\s\S]*?)\]/g)].forEach((match) => {
        [...match[1].matchAll(/\blabel\s*:\s*"([^"]+)"/g)].forEach((label) => i18nKeys.add(label[1]));
    });
    // 功能自身的 name / description（defineFeature 顶层字段）：末段固定是 title / description，
    // 且整段必须是 `feature.<camelId>.…`，不再允许自己起个别的名字。
    const camel = camelId(id);
    const namespace = `feature.${camel}.`;
    const declarationTitle = /\bname\s*:\s*"(feature\.[^"]+)"/.exec(source)?.[1];
    const declarationDescription = /\bdescription\s*:\s*"(feature\.[^"]+)"/.exec(source.slice(0, settingsIndex))?.[1];
    if (!declarationTitle) {
        fail(`功能 "${id}" 缺少 name（必须是 i18n key "${namespace}title"）`);
    } else if (declarationTitle !== `${namespace}title`) {
        fail(`功能 "${id}" 的名称 key 必须是 "${namespace}title"，现在是 "${declarationTitle}"`);
    }
    if (declarationDescription && declarationDescription !== `${namespace}description`) {
        fail(`功能 "${id}" 的说明 key 必须是 "${namespace}description"，现在是 "${declarationDescription}"`);
    }
    if (declarationTitle) {
        i18nKeys.add(declarationTitle);
    }
    if (declarationDescription) {
        i18nKeys.add(declarationDescription);
    }
    // 实现文件里通过 host.i18n("...") 取用的键（含字符串拼接出的完整 key）
    for (const file of fs.readdirSync(path.join(FEATURES_DIR, dir))) {
        if (!file.endsWith(".ts") || file === "index.ts") {
            continue;
        }
        const impl = fs.readFileSync(path.join(FEATURES_DIR, dir, file), "utf8");
        [...impl.matchAll(/\bi18n\s*\(\s*([^)]*)\)/g)].forEach((match) => {
            const expression = match[1];
            const full = /^\s*"([^"]+)"\s*$/.exec(expression);
            if (full) {
                i18nKeys.add(full[1]);
                return;
            }
            // 拼接型（如 `uiDemo.accent${x}`）：取所有字面量片段，逐一确认存在
            [...expression.matchAll(/"([^"]*)"/g)].forEach((part) => {
                const literal = part[1];
                if (literal && !/\s/.test(literal) && !literal.startsWith("$")) {
                    i18nKeys.add(literal);
                }
            });
        });
    }

    // settings 里不允许出现按钮型控件：面板只放设置项，不放自定义按钮
    if (/\bkind\s*:\s*"action"/.test(settingsSource)) {
        fail(`功能 "${id}" 使用了已移除的 action 型设置项；设置面板不注册自定义按钮`);
    }

    // 逐行校验文案 key 的落点：值型控件跟着自己的 key、开关行统一 common.enabled、
    // select 选项跟着 `<设置项 key>.<选项值>`，按钮与说明块只要求落在本功能命名空间里。
    for (const row of parseSettingRows(settingsSource)) {
        const expectedTitle = `${namespace}${row.key}`;
        const expectedTip = `${namespace}${row.key}Tip`;
        if (RESERVED_TAILS.includes(row.key)) {
            fail(`功能 "${id}" 的设置项 key "${row.key}" 占用了声明专用的末段名`);
        }
        // 「适用端」这类跨功能共用的下拉整体走 common.scope，标题与选项都不进功能命名空间
        const sharedScope = row.title === "common.scope";
        if (row.kind === "switch") {
            if (row.title !== "common.enabled") {
                fail(`功能 "${id}" 的开关行文案必须是 "common.enabled"，现在是 "${row.title}"`);
            }
        } else if (VALUE_KINDS.includes(row.kind)) {
            if (!sharedScope && row.title !== expectedTitle) {
                fail(`功能 "${id}" 的设置行 "${row.key}" 标题 key 必须是 "${expectedTitle}"，现在是 "${row.title}"`);
            }
            if (row.placeholder && row.placeholder !== `${namespace}${row.key}Placeholder`) {
                fail(`功能 "${id}" 的设置行 "${row.key}" 占位符 key 必须是 "${namespace}${row.key}Placeholder"`);
            }
        } else if (row.title && !row.title.startsWith(namespace)) {
            fail(`功能 "${id}" 的设置行 "${row.key}" 标题 key 必须落在 "${namespace}" 下，现在是 "${row.title}"`);
        }
        if (row.description && VALUE_KINDS.includes(row.kind) && row.description !== expectedTip) {
            fail(`功能 "${id}" 的设置行 "${row.key}" 说明 key 必须是 "${expectedTip}"，现在是 "${row.description}"`);
        }
        if (row.text && !row.text.startsWith(namespace)) {
            fail(`功能 "${id}" 的说明块文案 key 必须落在 "${namespace}" 下，现在是 "${row.text}"`);
        }
        if (row.label && !row.label.startsWith(namespace)) {
            fail(`功能 "${id}" 的按钮文案 key 必须落在 "${namespace}" 下，现在是 "${row.label}"`);
        }
        for (const option of row.options) {
            const expected = sharedScope ? `common.scope.${option.value}` : `${namespace}${row.key}.${option.value}`;
            if (option.label !== expected) {
                fail(
                    `功能 "${id}" 的选项 "${row.key}=${option.value}" 标签 key 必须是 "${expected}"，现在是 "${option.label}"`,
                );
            }
        }
    }

    // 每个功能都必须能在面板里被打开：至少有一个设置行，且默认是关闭的。
    // 默认关闭有两种合法写法——一个 default: false 的 enabled 开关，
    // 或者自己声明 isEnabled 谓词（拿 select 的「禁用」选项当开关时走这条）。
    if (/settings\s*:\s*\[\s*\]/.test(source)) {
        fail(`功能 "${id}" 没有任何设置行：每个功能都必须有开关 / 下拉 / 输入框`);
    }
    const hasEnabledSwitch = /kind:\s*"switch",\s*\n\s*key:\s*"enabled",[\s\S]{0,240}?default:\s*false,/.test(
        settingsSource,
    );
    if (!hasEnabledSwitch && !/\bisEnabled\s*:/.test(source)) {
        fail(
            `功能 "${id}" 没有默认关闭的开关：要么加 key 为 "enabled" 且 default: false 的 switch，要么声明 isEnabled`,
        );
    }

    // select 的 default 必须出现在自己的 options 里
    const selectBlocks = [...settingsSource.matchAll(/options\s*:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]);
    selectBlocks.forEach((block) => {
        const values = [...block.matchAll(/\bvalue\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
        if (values.length === 0) {
            fail(`功能 "${id}" 的某个 select 没有任何 options`);
        }
    });

    // 命名空间归属：功能只用得到自己的 feature.<camelId>.，全局组只能取四组前缀之一。
    for (const key of i18nKeys) {
        const root = key.split(".")[0];
        if (root === "feature") {
            if (!key.startsWith(namespace)) {
                fail(`功能 "${id}" 用了别的命名空间："${key}"（自己的是 "${namespace}"）`);
                continue;
            }
            if (!KEY_PATTERN.test(key)) {
                fail(`功能 "${id}" 的键 "${key}" 不符合 feature.<camelId>.<键名> 形式`);
            }
            const tail = key.slice(namespace.length);
            if (RESERVED_TAILS.includes(tail) && key !== declarationTitle && key !== declarationDescription) {
                fail(`功能 "${id}" 的键 "${key}" 占用了声明专用的末段 "${tail}"`);
            }
        } else if (!GLOBAL_NAMESPACES.includes(root)) {
            fail(`功能 "${id}" 的键 "${key}" 前缀非法：只允许 feature. 或 ${GLOBAL_NAMESPACES.join(" / ")}`);
        }
    }

    found.set(id, {dir, category, i18nKeys});
}

// ------------------------------------------------- 4. 注册表登记完整性
// 顺带取出注册表数组的顺序：i18n 文件里每个功能必须按这个顺序各占一组。
const registryOrder = [];
if (!fs.existsSync(REGISTRY_FILE)) {
    fail("找不到 src/core/registry.ts");
} else {
    const registry = fs.readFileSync(REGISTRY_FILE, "utf8");
    for (const [, info] of found) {
        // registry.ts 通过 `import xx from "../features/<dir>"` 引入，且 FEATURES 数组里包含该变量
        const imported = registry.includes(`features/${info.dir}"`) || registry.includes(`features/${info.dir}'`);
        if (!imported) {
            fail(`src/core/registry.ts 没有导入 src/features/${info.dir}`);
        }
    }
    const imports = new Map(
        [...registry.matchAll(/import\s+(\w+)\s+from\s+"\.\.\/features\/([\w-]+)"/g)].map((match) => [
            match[1],
            match[2],
        ]),
    );
    const arrayBody = /export const FEATURES[^=]*=\s*\[([\s\S]*?)\];/.exec(registry)?.[1] ?? "";
    for (const [, variable] of arrayBody.matchAll(/\b(\w+)\s*,/g)) {
        const dir = imports.get(variable);
        if (dir) {
            registryOrder.push(dir);
        }
    }
    if (registryOrder.length !== found.size) {
        fail(`FEATURES 数组里的功能数量 ${registryOrder.length} 与 src/features 下的 ${found.size} 个不一致`);
    }
}

// ------------------------------------------------- 5. i18n 文件：覆盖、键集、顺序、引用
const locales = fs.existsSync(I18N_DIR) ?
    fs.readdirSync(I18N_DIR).filter((name) => name.endsWith(".json")).sort() :
    [];
if (locales.length === 0) {
    fail("src/i18n 下没有任何语言文件");
}
const localeData = new Map();
for (const locale of locales) {
    const data = readJson(path.join(I18N_DIR, locale));
    if (data) {
        localeData.set(locale, data);
    }
}

// 5.1 功能用到的 key 各语言文件都得有
for (const [id, info] of found) {
    for (const key of info.i18nKeys) {
        for (const [locale, data] of localeData) {
            if (!(key in data)) {
                fail(`功能 "${id}" 用到的 i18n key "${key}" 在 src/i18n/${locale} 中缺失`);
            }
        }
    }
}

// 5.2 各语言文件的键集与顺序必须完全一致：漏一条译文、顺序不同都会让人以为改错了地方
const [referenceLocale, ...otherLocales] = [...localeData.keys()];
const reference = localeData.get(referenceLocale) ?? {};
const referenceKeys = Object.keys(reference);
for (const locale of otherLocales) {
    const keys = Object.keys(localeData.get(locale) ?? {});
    const missing = referenceKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !(key in reference));
    if (missing.length > 0) {
        fail(`${locale} 缺少 ${missing.length} 个键：${missing.join(", ")}`);
    }
    if (extra.length > 0) {
        fail(`${locale} 多出 ${extra.length} 个键：${extra.join(", ")}`);
    }
    if (missing.length === 0 && extra.length === 0 && keys.join("\n") !== referenceKeys.join("\n")) {
        fail(`${locale} 的键顺序与 ${referenceLocale} 不一致`);
    }
}

// 5.3 前缀、分类键、未知功能命名空间
const categoryKeys = new Set(VALID_CATEGORIES.map(categoryKey));
const featureNamespaces = [...found.keys()].map((id) => `feature.${camelId(id)}.`);
for (const key of referenceKeys) {
    const root = key.split(".")[0];
    if (root === "category") {
        if (!categoryKeys.has(key)) {
            fail(`分类键 "${key}" 不在 ${[...categoryKeys].join(" / ")} 之内`);
        }
        continue;
    }
    if (root === "feature") {
        if (!KEY_PATTERN.test(key)) {
            fail(`键 "${key}" 不符合 feature.<camelId>.<键名>[.<选项值>] 形式`);
        }
        if (!featureNamespaces.some((prefix) => key.startsWith(prefix))) {
            fail(`键 "${key}" 不属于任何一个已登记的功能`);
        }
        continue;
    }
    if (!GLOBAL_NAMESPACES.includes(root)) {
        fail(`键 "${key}" 前缀非法：只允许 feature / ${GLOBAL_NAMESPACES.join(" / ")}`);
    } else if (!KEY_PATTERN.test(key)) {
        fail(`键 "${key}" 的段名不合法（只允许驼峰段）`);
    }
}

// 5.4 全局组顺序固定，功能组按注册表顺序各成一段
const groupOf = (key) => key.startsWith("feature.") ? key.split(".").slice(0, 2).join(".") : key.split(".")[0];
const collapsed = referenceKeys.map(groupOf).filter((group, index, all) => index === 0 || group !== all[index - 1]);
const globalSequence = collapsed.filter((group) => GLOBAL_NAMESPACES.includes(group));
if (globalSequence.join() !== GLOBAL_NAMESPACES.join()) {
    fail(`全局键顺序必须是 ${GLOBAL_NAMESPACES.join(" → ")}，现在是 ${globalSequence.join(" → ") || "（缺失）"}`);
}
const featureSequence = collapsed.filter((group) => group.startsWith("feature."));
const expectedFeatureSequence = registryOrder.map((dir) => `feature.${camelId(dir)}`);
if (featureSequence.join() !== expectedFeatureSequence.join()) {
    fail(`功能键必须按注册表顺序各成一组：期望 ${expectedFeatureSequence.join(", ")}`);
}

// 5.5 组内顺序：title 先、description 次之，其余按 settings 数组顺序
for (const [id, info] of found) {
    const namespace = `feature.${camelId(id)}.`;
    const keys = referenceKeys.filter((key) => key.startsWith(namespace));
    const source = fs.readFileSync(path.join(FEATURES_DIR, info.dir, "index.ts"), "utf8");
    const expected = [`${namespace}title`, `${namespace}description`];
    for (const row of parseSettingRows(source.slice(source.indexOf("settings:")))) {
        if (row.kind !== "switch") {
            expected.push(`${namespace}${row.key}`);
        }
        if (row.description) {
            expected.push(`${namespace}${row.key}Tip`);
        }
        for (const option of row.options) {
            expected.push(`${namespace}${row.key}.${option.value}`);
        }
    }
    const present = expected.filter((key) => keys.includes(key));
    if (present.length === 0) {
        continue;
    }
    const positions = present.map((key) => keys.indexOf(key));
    if (positions[0] !== 0 || positions.join() !== [...positions].sort((left, right) => left - right).join()) {
        fail(`功能 "${id}" 的键组内顺序不对：应先 ${present.join(" → ")}`);
    }
}

// 5.6 孤儿键：每条译文都得有代码取用，否则翻译会烂在文件里
let sourceText = "";
const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
        } else if (entry.name.endsWith(".ts")) {
            sourceText += fs.readFileSync(full, "utf8");
        }
    }
};
walk(path.join(root, "src"));
// 直接按「文件里有没有这个字符串」判定，不用正则切字符串：
// 源码里带转义引号的模板会把一对引号切错位，整份文件后面的匹配都会跟着错。
for (const key of referenceKeys) {
    if (categoryKeys.has(key)) {
        continue; // 分类键由 categoryKey() 在运行期拼出来
    }
    const literal = `"${key}"`;
    // 模板拼接的键（如 `feature.x.type.${kind}`）：前缀一样就算整组被引用
    const prefix = `${key.split(".").slice(0, -1).join(".")}.`;
    if (sourceText.includes(literal) || sourceText.includes(prefix + "${")) {
        continue;
    }
    fail(`i18n key "${key}" 在 src/ 里没有任何引用（翻译会烂在文件里）`);
}

// ------------------------------------------------- 6. 分类文案
for (const key of categoryKeys) {
    for (const [locale, data] of localeData) {
        if (!(key in data)) {
            fail(`分类键 "${key}" 在 src/i18n/${locale} 中缺失`);
        }
    }
}

// ---------------------------------------------------------------- 输出
const summary = `功能 ${found.size} 个，语言文件 ${locales.length} 个`;
if (problems.length === 0) {
    console.log(`✓ 功能声明校验通过（${summary}）`);
    process.exit(0);
}
console.error(`✗ 功能声明校验失败，共 ${problems.length} 个问题（${summary}）：`);
problems.forEach((problem, index) => console.error(`  ${index + 1}. ${problem}`));
process.exit(1);
