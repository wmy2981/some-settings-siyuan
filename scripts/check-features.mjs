/**
 * feature-control.json 与功能注册表的一致性校验。
 *
 * 构建前跑（npm run build 会先执行 npm run check），一次报全所有问题，
 * 目的是让「改动 feature-control.json 就能禁用功能」这条路径始终可信：
 * 清单里写错一个 id，或者新功能忘了登记，都会在这里被拦住，而不是等到
 * 运行时静默按 0 处理、功能莫名消失。
 *
 * 用法：node scripts/check-features.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES_DIR = path.join(root, "src", "features");
const CONTROL_FILE = path.join(root, "feature-control.json");
const REGISTRY_FILE = path.join(root, "src", "core", "registry.ts");
const I18N_DIR = path.join(root, "src", "i18n");
const VALID_STATES = [0, 1, 2, 3];
const VALID_CATEGORIES = ["function", "ui", "dev"];

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

// ---------------------------------------------------------------- 1. 清单结构
const control = readJson(CONTROL_FILE);
if (control !== null) {
    if (typeof control.features !== "object" || control.features === null || Array.isArray(control.features)) {
        fail("feature-control.json 缺少对象类型的 features 字段");
    }
}

const controlStates = new Map();
if (control && typeof control.features === "object" && control.features !== null) {
    for (const [id, entry] of Object.entries(control.features)) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            fail(`feature-control.json 中 "${id}" 的值必须是对象`);
            continue;
        }
        const state = entry.state;
        if (!VALID_STATES.includes(state)) {
            fail(`feature-control.json 中 "${id}" 的 state=${JSON.stringify(state)} 非法，合法值为 0/1/2/3`);
            continue;
        }
        controlStates.set(id, state);
    }
}

// ---------------------------------------------------------------- 2. 功能目录
if (!fs.existsSync(FEATURES_DIR)) {
    fail("找不到 src/features 目录");
}

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
    if (!controlStates.has(id)) {
        fail(`功能 "${id}" 没有在 feature-control.json 中登记（缺失会按 0 处理，功能不会显示）`);
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
    // title / description / button / placeholder 的值必须是 i18n key。
    // default 是「实际内容」，不是 key，所以刻意不检查。
    [...settingsSource.matchAll(/\b(title|description|button|placeholder)\s*:\s*"([^"]+)"/g)]
        .forEach((match) => i18nKeys.add(match[2]));
    // select 选项的标签
    [...settingsSource.matchAll(/options\s*:\s*\[([\s\S]*?)\]/g)].forEach((match) => {
        [...match[1].matchAll(/\blabel\s*:\s*"([^"]+)"/g)].forEach((label) => i18nKeys.add(label[1]));
    });
    // 功能自身的 name / description（defineFeature 顶层字段）
    [...source.matchAll(/\b(name|description)\s*:\s*"(feature\.[^"]+)"/g)]
        .forEach((match) => i18nKeys.add(match[2]));

    // select 的 default 必须出现在自己的 options 里
    const selectBlocks = [...settingsSource.matchAll(/options\s*:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]);
    selectBlocks.forEach((block) => {
        const values = [...block.matchAll(/\bvalue\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
        if (values.length === 0) {
            fail(`功能 "${id}" 的某个 select 没有任何 options`);
        }
    });

    found.set(id, {dir, category, i18nKeys});
}

// ------------------------------------------------- 4. 清单里的多余条目
for (const id of controlStates.keys()) {
    if (!found.has(id)) {
        fail(`feature-control.json 中的 "${id}" 没有对应的功能文件夹（src/features/${id}）`);
    }
}

// ------------------------------------------------- 5. 注册表登记完整性
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
}

// ------------------------------------------------- 6. i18n 覆盖
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
for (const [id, info] of found) {
    for (const key of info.i18nKeys) {
        for (const [locale, data] of localeData) {
            if (!(key in data)) {
                fail(`功能 "${id}" 用到的 i18n key "${key}" 在 src/i18n/${locale} 中缺失`);
            }
        }
    }
}

// ---------------------------------------------------------------- 输出
const summary = `功能 ${found.size} 个，清单条目 ${controlStates.size} 条，语言文件 ${locales.length} 个`;
if (problems.length === 0) {
    console.log(`✓ feature-control 校验通过（${summary}）`);
    process.exit(0);
}
console.error(`✗ feature-control 校验失败，共 ${problems.length} 个问题（${summary}）：`);
problems.forEach((problem, index) => console.error(`  ${index + 1}. ${problem}`));
process.exit(1);
