// @vitest-environment node
/**
 * 功能声明层的一致性测试。
 *
 * 这一份文件覆盖**全部**功能，不逐个功能重复：`scripts/check-features.mjs` 只在构建前
 * 拦「少写 enabled / 分类写错」这类问题，而运行期的约束（i18n key 有没有落地、
 * 默认是否真的关闭、有开关却没实现、只有动作行却声明了开关）只能在这里守。
 *
 * 新增功能只要写进 `src/features/<id>/index.ts` 并在 `registry.ts` 登记，
 * 会自动被这里全部覆盖，不需要再加断言。
 */
import fs from "node:fs";
import path from "node:path";
import {
    describe,
    expect,
    it,
} from "vitest";
import {defaultConfig} from "../../src/core/config";
import {FEATURES} from "../../src/core/registry";
import {FEATURE_CATEGORIES} from "../../src/core/types";
import type {
    FeatureCategory,
    FeatureDefinition,
    SettingField,
} from "../../src/core/types";
import {
    compareVersion,
    parseVersion,
} from "../../src/core/version";

const sourceDir = path.join(process.cwd(), "src", "features");
const featureDirs = fs.readdirSync(sourceDir, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/** `src/i18n` 下的全部语言文件，按文件名排序；新增语言不用再改这里。 */
const localeDir = path.join(process.cwd(), "src", "i18n");
const locales = new Map(
    fs.readdirSync(localeDir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => [
            file,
            JSON.parse(fs.readFileSync(path.join(localeDir, file), "utf8")) as Record<string, string>,
        ]),
);

const localeOf = (locale: Record<string, unknown>, key: string): string | undefined => {
    const value = locale[key];
    return typeof value === "string" ? value : undefined;
};

/** 一个设置行用到的全部 i18n key（`note` / `button` 的文案、下拉选项的文案都算）。 */
const i18nKeysOfField = (field: SettingField): string[] => {
    const keys: string[] = [];
    switch (field.kind) {
        case "note":
            keys.push(field.text);
            field.actions?.forEach((action) => {
                if (typeof action.label === "string") {
                    keys.push(action.label);
                }
            });
            break;
        case "button":
            keys.push(field.title);
            keys.push(...(field.description ? [field.description] : []));
            if (typeof field.label === "string") {
                keys.push(field.label);
            }
            break;
        default:
            keys.push(field.title);
            keys.push(...(field.description ? [field.description] : []));
            if (field.kind === "select" && field.options) {
                keys.push(...field.options.map((option) => option.label));
            }
            break;
    }
    return keys;
};

/** 功能自己的文案 key。 */
const i18nKeysOfFeature = (definition: FeatureDefinition): string[] => [
    definition.name,
    ...(definition.description ? [definition.description] : []),
    ...definition.settings.flatMap(i18nKeysOfField),
];

/** 只有动作行 / 说明块、没有开关的功能（清理配置、导入导出这类）。 */
const isActionOnly = (definition: FeatureDefinition): boolean =>
    definition.settings.every((field) => field.kind === "note" || field.kind === "button");

describe("功能声明", () => {
    it("注册表与文件夹一一对应，既没有漏登记的目录，也没有指向不存在目录的条目", () => {
        expect(FEATURES.map((feature) => feature.id).slice().sort()).toEqual(featureDirs);
    });

    it("id 唯一", () => {
        const ids = FEATURES.map((feature) => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("每个功能都声明了合法的分类与显式的 enabled", () => {
        FEATURES.forEach((feature) => {
            expect(FEATURE_CATEGORIES).toContain(feature.category as FeatureCategory);
            expect(typeof feature.enabled).toBe("boolean");
        });
    });

    it("每个功能都至少有一个设置行，且 key 在功能内唯一", () => {
        FEATURES.forEach((feature) => {
            expect(feature.settings.length, feature.id).toBeGreaterThan(0);
            const keys = feature.settings.map((field) => field.key);
            expect(new Set(keys).size, feature.id).toBe(keys.length);
        });
    });

    it("首个设置行默认为关闭的开关，除非该功能声明了 isEnabled 谓词", () => {
        FEATURES.filter((feature) => !isActionOnly(feature)).forEach((feature) => {
            if (feature.isEnabled) {
                expect(typeof feature.isEnabled, feature.id).toBe("function");
                return;
            }
            expect(feature.settings[0].kind, feature.id).toBe("switch");
            expect(feature.settings[0], feature.id).toMatchObject({key: "enabled", default: false});
        });
    });

    it("默认配置下功能一律不运行", () => {
        FEATURES.forEach((feature) => {
            const config = defaultConfig(feature.settings);
            const running = feature.isEnabled ? feature.isEnabled(config) : config.enabled === true;
            expect(running, feature.id).toBe(false);
        });
    });

    it("有设置控件功能必须有 mount，纯动作行功能不许挂载", () => {
        FEATURES.forEach((feature) => {
            if (isActionOnly(feature)) {
                expect(feature.mount, feature.id).toBeUndefined();
                if (feature.isEnabled) {
                    expect(feature.isEnabled(defaultConfig(feature.settings)), feature.id).toBe(false);
                }
                return;
            }
            expect(typeof feature.mount, feature.id).toBe("function");
            expect(
                feature.settings.some((field) => field.kind !== "note" && field.kind !== "button"),
                feature.id,
            ).toBe(true);
        });
    });

    it("文案 key 在每个语言文件里都有非空译文", () => {
        FEATURES.forEach((feature) => {
            i18nKeysOfFeature(feature).forEach((key) => {
                locales.forEach((data, file) => {
                    expect(localeOf(data, key), `${feature.id}: ${key} (${file})`).toBeTruthy();
                });
            });
        });
    });

    it("i18n 的键集与顺序在每个语言文件里完全一致", () => {
        const [referenceFile, reference] = [...locales.entries()][0];
        const referenceKeys = Object.keys(reference);
        locales.forEach((data, file) => {
            if (file === referenceFile) {
                return;
            }
            expect(Object.keys(data), `${file} 与 ${referenceFile} 的键顺序不一致`).toEqual(referenceKeys);
        });
    });

    it("版本区间合法：能解析，且下限不高于上限", () => {
        FEATURES.forEach((feature) => {
            const min = feature.minAppVersion ? parseVersion(feature.minAppVersion) : undefined;
            const max = feature.maxAppVersion ? parseVersion(feature.maxAppVersion) : undefined;
            if (feature.minAppVersion) {
                expect(min, `${feature.id}: ${feature.minAppVersion}`).toBeTruthy();
            }
            if (feature.maxAppVersion) {
                expect(max, `${feature.id}: ${feature.maxAppVersion}`).toBeTruthy();
            }
            if (min && max) {
                expect(compareVersion(min, max), feature.id).toBeLessThanOrEqual(0);
            }
        });
    });

    it("frontends 只写平台认识的两个值", () => {
        FEATURES.forEach((feature) => {
            feature.frontends?.forEach((frontend) => {
                expect(["desktop", "mobile"], `${feature.id}: ${frontend}`).toContain(frontend);
            });
        });
    });

    it("以 selector / 下拉值当开关的功能，isEnabled 必须能识别被禁用的取值", () => {
        FEATURES.filter((feature) => feature.isEnabled).forEach((feature) => {
            const config = defaultConfig(feature.settings);
            const disabled = feature.isEnabled?.(config);
            expect(disabled, feature.id).toBe(false);
        });
    });
});
