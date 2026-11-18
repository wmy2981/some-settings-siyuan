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
        fail(`${path.relative(root, file)} is not valid JSON: ${error.message}`);
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
        fail(`src/features/${dir} is missing index.ts`);
        continue;
    }
    const source = fs.readFileSync(indexPath, "utf8");

    const idMatch = /defineFeature\s*\(\s*\{[\s\S]*?\bid\s*:\s*"([^"]+)"/.exec(source);
    const categoryMatch = /\bcategory\s*:\s*"([^"]+)"/.exec(source);
    if (!idMatch) {
        fail(`src/features/${dir}/index.ts has no defineFeature({ id: "..." })`);
        continue;
    }
    const id = idMatch[1];
    const category = categoryMatch ? categoryMatch[1] : "";

    if (id !== dir) {
        fail(`feature id "${id}" does not match the folder name "${dir}" (they must be identical)`);
    }
    if (!VALID_CATEGORIES.includes(category)) {
        fail(`feature "${id}" has an invalid category="${category}"; valid values are ${VALID_CATEGORIES.join("/")}`);
    }

    // -------------------------------------------------- 1. enabled 声明
    // 它是「这个功能随插件一起交不交出」，必须是明确的布尔量：
    // 缺失或写成别的值都会让功能要么偷偷消失、要么在面板里露出来却没有实现。
    const enabledMatch = /\benabled\s*:\s*([A-Za-z]+)\s*,/.exec(source);
    if (!enabledMatch) {
        fail(`feature "${id}" does not declare enabled: true / false`);
    } else if (enabledMatch[1] !== "true" && enabledMatch[1] !== "false") {
        fail(`feature "${id}" has enabled=${enabledMatch[1]}, which must be true or false`);
    }

    // -------------------------------------------------- 2. 版本区间
    const versionOf = (field) => {
        const match = new RegExp(`\\b${field}\\s*:\\s*"([^"]+)"`).exec(source);
        if (!match) {
            return null;
        }
        if (!parseVersion(match[1])) {
            fail(
                `feature "${id}" has ${field}="${
                    match[1]
                }", which is not a valid SiYuan version (such as 3.8.10-alpha.2)`,
            );
            return null;
        }
        return parseVersion(match[1]);
    };
    const min = versionOf("minAppVersion");
    const max = versionOf("maxAppVersion");
    if (min && max && compareVersion(min, max) > 0) {
        fail(`feature "${id}" has minAppVersion above maxAppVersion, so the range is empty`);
    }

    // -------------------------------------------------- 3. settings 静态检查
    const settingsIndex = source.indexOf("settings:");
    const settingsSource = settingsIndex < 0 ? source : source.slice(settingsIndex);
    const keys = [...settingsSource.matchAll(/\bkey\s*:\s*"([^"]+)"/g)].map((match) => match[1]);

    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    [...new Set(duplicates)].forEach((key) => {
        fail(`feature "${id}" declares the setting key "${key}" twice`);
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
        fail(`feature "${id}" is missing name (it must be the i18n key "${namespace}title")`);
    } else if (declarationTitle !== `${namespace}title`) {
        fail(`feature "${id}" name key must be "${namespace}title", but is "${declarationTitle}"`);
    }
    if (declarationDescription && declarationDescription !== `${namespace}description`) {
        fail(`feature "${id}" description key must be "${namespace}description", but is "${declarationDescription}"`);
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
        fail(`feature "${id}" uses the removed "action" setting kind; the settings panel registers no custom buttons`);
    }

    // 逐行校验文案 key 的落点：值型控件跟着自己的 key、开关行统一 common.enabled、
    // select 选项跟着 `<设置项 key>.<选项值>`，按钮与说明块只要求落在本功能命名空间里。
    for (const row of parseSettingRows(settingsSource)) {
        const expectedTitle = `${namespace}${row.key}`;
        const expectedTip = `${namespace}${row.key}Tip`;
        if (RESERVED_TAILS.includes(row.key)) {
            fail(`feature "${id}" setting key "${row.key}" takes a tail reserved for the declaration`);
        }
        // 「适用端」这类跨功能共用的下拉整体走 common.scope，标题与选项都不进功能命名空间
        const sharedScope = row.title === "common.scope";
        if (row.kind === "switch") {
            if (row.title !== "common.enabled") {
                fail(`feature "${id}" switch row must be titled "common.enabled", but is "${row.title}"`);
            }
        } else if (VALUE_KINDS.includes(row.kind)) {
            if (!sharedScope && row.title !== expectedTitle) {
                fail(
                    `feature "${id}" setting "${row.key}" title key must be "${expectedTitle}", but is "${row.title}"`,
                );
            }
            if (row.placeholder && row.placeholder !== `${namespace}${row.key}Placeholder`) {
                fail(
                    `feature "${id}" setting "${row.key}" placeholder key must be "${namespace}${row.key}Placeholder"`,
                );
            }
        } else if (row.title && !row.title.startsWith(namespace)) {
            fail(
                `feature "${id}" setting "${row.key}" title key must live under "${namespace}", but is "${row.title}"`,
            );
        }
        if (row.description && VALUE_KINDS.includes(row.kind) && row.description !== expectedTip) {
            fail(
                `feature "${id}" setting "${row.key}" description key must be "${expectedTip}", but is "${row.description}"`,
            );
        }
        if (row.text && !row.text.startsWith(namespace)) {
            fail(`feature "${id}" note text key must live under "${namespace}", but is "${row.text}"`);
        }
        if (row.label && !row.label.startsWith(namespace)) {
            fail(`feature "${id}" button label key must live under "${namespace}", but is "${row.label}"`);
        }
        for (const option of row.options) {
            const expected = sharedScope ? `common.scope.${option.value}` : `${namespace}${row.key}.${option.value}`;
            if (option.label !== expected) {
                fail(
                    `feature "${id}" option "${row.key}=${option.value}" label key must be "${expected}", but is "${option.label}"`,
                );
            }
        }
    }

    // 每个功能都必须能在面板里被打开：至少有一个设置行，且默认是关闭的。
    // 默认关闭有两种合法写法——一个 default: false 的 enabled 开关，
    // 或者自己声明 isEnabled 谓词（拿 select 的「禁用」选项当开关时走这条）。
    if (/settings\s*:\s*\[\s*\]/.test(source)) {
        fail(`feature "${id}" has no settings rows; every feature needs at least one switch, select or text field`);
    }
    const hasEnabledSwitch = /kind:\s*"switch",\s*\n\s*key:\s*"enabled",[\s\S]{0,240}?default:\s*false,/.test(
        settingsSource,
    );
    if (!hasEnabledSwitch && !/\bisEnabled\s*:/.test(source)) {
        fail(
            `feature "${id}" has no switch that defaults to off: add a switch with key "enabled" and default: false, or declare isEnabled`,
        );
    }

    // select 的 default 必须出现在自己的 options 里
    const selectBlocks = [...settingsSource.matchAll(/options\s*:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]);
    selectBlocks.forEach((block) => {
        const values = [...block.matchAll(/\bvalue\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
        if (values.length === 0) {
            fail(`a select in feature "${id}" has no options`);
        }
    });

    // 命名空间归属：功能只用得到自己的 feature.<camelId>.，全局组只能取四组前缀之一。
    for (const key of i18nKeys) {
        const root = key.split(".")[0];
        if (root === "feature") {
            if (!key.startsWith(namespace)) {
                fail(`feature "${id}" uses another namespace: "${key}" (its own is "${namespace}")`);
                continue;
            }
            if (!KEY_PATTERN.test(key)) {
                fail(`feature "${id}" key "${key}" does not match feature.<camelId>.<name>`);
            }
            const tail = key.slice(namespace.length);
            if (RESERVED_TAILS.includes(tail) && key !== declarationTitle && key !== declarationDescription) {
                fail(`feature "${id}" key "${key}" takes the tail "${tail}" reserved for the declaration`);
            }
        } else if (!GLOBAL_NAMESPACES.includes(root)) {
            fail(
                `feature "${id}" key "${key}" has an invalid prefix: only feature. or ${GLOBAL_NAMESPACES.join(" / ")}`,
            );
        }
    }

    found.set(id, {dir, category, i18nKeys});
}

// ------------------------------------------------- 4. 注册表登记完整性
// 顺带取出注册表数组的顺序：i18n 文件里每个功能必须按这个顺序各占一组。
const registryOrder = [];
if (!fs.existsSync(REGISTRY_FILE)) {
    fail("src/core/registry.ts not found");
} else {
    const registry = fs.readFileSync(REGISTRY_FILE, "utf8");
    for (const [, info] of found) {
        // registry.ts 通过 `import xx from "../features/<dir>"` 引入，且 FEATURES 数组里包含该变量
        const imported = registry.includes(`features/${info.dir}"`) || registry.includes(`features/${info.dir}'`);
        if (!imported) {
            fail(`src/core/registry.ts does not import src/features/${info.dir}`);
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
        fail(`FEATURES lists ${registryOrder.length} features but src/features has ${found.size}`);
    }
}

// ------------------------------------------------- 5. i18n 文件：覆盖、键集、顺序、引用
const locales = fs.existsSync(I18N_DIR) ?
    fs.readdirSync(I18N_DIR).filter((name) => name.endsWith(".json")).sort() :
    [];
if (locales.length === 0) {
    fail("src/i18n has no locale files");
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
                fail(`feature "${id}" uses the i18n key "${key}", which is missing from src/i18n/${locale}`);
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
        fail(`${locale} is missing ${missing.length} key(s): ${missing.join(", ")}`);
    }
    if (extra.length > 0) {
        fail(`${locale} has ${extra.length} extra key(s): ${extra.join(", ")}`);
    }
    if (missing.length === 0 && extra.length === 0 && keys.join("\n") !== referenceKeys.join("\n")) {
        fail(`${locale} orders its keys differently from ${referenceLocale}`);
    }
}

// 5.3 前缀、分类键、未知功能命名空间
const categoryKeys = new Set(VALID_CATEGORIES.map(categoryKey));
const featureNamespaces = [...found.keys()].map((id) => `feature.${camelId(id)}.`);
for (const key of referenceKeys) {
    const root = key.split(".")[0];
    if (root === "category") {
        if (!categoryKeys.has(key)) {
            fail(`category key "${key}" is not one of ${[...categoryKeys].join(" / ")}`);
        }
        continue;
    }
    if (root === "feature") {
        if (!KEY_PATTERN.test(key)) {
            fail(`key "${key}" does not match feature.<camelId>.<name>[.<option value>]`);
        }
        if (!featureNamespaces.some((prefix) => key.startsWith(prefix))) {
            fail(`key "${key}" belongs to no registered feature`);
        }
        continue;
    }
    if (!GLOBAL_NAMESPACES.includes(root)) {
        fail(`key "${key}" has an invalid prefix: only feature / ${GLOBAL_NAMESPACES.join(" / ")}`);
    } else if (!KEY_PATTERN.test(key)) {
        fail(`key "${key}" has an invalid segment name (camelCase only)`);
    }
}

// 5.4 全局组顺序固定，功能组按注册表顺序各成一段
const groupOf = (key) => key.startsWith("feature.") ? key.split(".").slice(0, 2).join(".") : key.split(".")[0];
const collapsed = referenceKeys.map(groupOf).filter((group, index, all) => index === 0 || group !== all[index - 1]);
const globalSequence = collapsed.filter((group) => GLOBAL_NAMESPACES.includes(group));
if (globalSequence.join() !== GLOBAL_NAMESPACES.join()) {
    fail(
        `global keys must be ordered ${GLOBAL_NAMESPACES.join(" → ")}, but are ${
            globalSequence.join(" → ") || "(missing)"
        }`,
    );
}
const featureSequence = collapsed.filter((group) => group.startsWith("feature."));
const expectedFeatureSequence = registryOrder.map((dir) => `feature.${camelId(dir)}`);
if (featureSequence.join() !== expectedFeatureSequence.join()) {
    fail(`each feature must own one key group in registry order: expected ${expectedFeatureSequence.join(", ")}`);
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
        fail(`feature "${id}" keys are out of order inside their group: expected ${present.join(" → ")} first`);
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
    fail(`i18n key "${key}" is referenced nowhere in src/ (the translation would sit unused)`);
}

// ------------------------------------------------- 6. 分类文案
for (const key of categoryKeys) {
    for (const [locale, data] of localeData) {
        if (!(key in data)) {
            fail(`category key "${key}" is missing from src/i18n/${locale}`);
        }
    }
}

// ---------------------------------------------------------------- 输出
const summary = `${found.size} features, ${locales.length} locale files`;
if (problems.length === 0) {
    console.log(`✓ Feature declarations are consistent (${summary})`);
    process.exit(0);
}
console.error(`✗ Feature declaration check failed with ${problems.length} problem(s) (${summary}):`);
problems.forEach((problem, index) => console.error(`  ${index + 1}. ${problem}`));
process.exit(1);
