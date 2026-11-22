// @vitest-environment node
/**
 * `core/registry.ts`：功能注册表。
 *
 * 注册表是「功能声明 → 面板 / 装载」的唯一清单，所以这里守的是清单本身的一致性：
 * id 与目录同名、enabled 显式为 true / false、开关约定、i18n key 真实存在，
 * 以及 `activeFeatures()` 这个唯一的有效性判定。
 */
import fs from "node:fs";
import path from "node:path";
import {
    describe,
    expect,
    it,
} from "vitest";
import {SHOW_UNAVAILABLE_FEATURE_ID} from "../../src/core/availability";
import {LOG_FEATURE_ID} from "../../src/core/log";
import {
    activeFeatures,
    categoryOrder,
    effectiveFeatures,
    FEATURES,
    featureById,
    featuresOf,
    resetEffectiveFeatures,
    setEffectiveFeatures,
} from "../../src/core/registry";
import {SEARCH_FEATURE_ID} from "../../src/core/search";
import {
    defineFeature,
    FEATURE_CATEGORIES,
} from "../../src/core/types";
import type {FeatureDefinition} from "../../src/core/types";
import {supportsCurrentHost} from "../../src/core/version";
import {mockState} from "../mocks/siyuan";

const ROOT = path.join(__dirname, "..", "..");
const LOCALE_DIR = path.join(ROOT, "src", "i18n");
/** 语言文件全部参与校验：新增一种语言不用再改这里。 */
const LOCALE_FILES = fs.readdirSync(LOCALE_DIR).filter((file) => file.endsWith(".json")).sort();
const readI18n = (file: string): Record<string, string> =>
    JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, file), "utf8")) as Record<string, string>;

describe("The registry itself", () => {
    it("Log output comes first: the loader relies on it to turn detailed logging on early", () => {
        // 装载器按数组顺序注册 / 挂载，排在后面的话它前面那些功能的装载日志会被开关吞掉
        expect(FEATURES[0].id).toBe(LOG_FEATURE_ID);
        expect(FEATURES[0].enabled).toBe(true);
    });

    it("ids are unique", () => {
        const ids = FEATURES.map((feature) => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("The show-unavailable-settings id matches the constant the panel reads", () => {
        // 面板靠这个 id 订阅开关变化：写成别的值，开关翻了条目也不会显隐
        expect(featureById(SHOW_UNAVAILABLE_FEATURE_ID)?.id).toBe(SHOW_UNAVAILABLE_FEATURE_ID);
    });

    it("The settings-search id matches the constant the panel reads", () => {
        // 面板靠这个 id 订阅开关变化：写成别的值，开关翻了搜索框也不会显隐
        expect(featureById(SEARCH_FEATURE_ID)?.id).toBe(SEARCH_FEATURE_ID);
    });

    it("ids use only lowercase letters, digits and hyphens", () => {
        FEATURES.forEach((feature) => {
            expect(feature.id).toMatch(/^[a-z0-9-]+$/);
        });
    });

    it("Every id has a matching feature directory", () => {
        FEATURES.forEach((feature) => {
            const entry = path.join(ROOT, "src", "features", feature.id, "index.ts");
            expect(fs.existsSync(entry), `missing ${entry}`).toBe(true);
        });
    });

    it("enabled must be an explicit true or false", () => {
        FEATURES.forEach((feature) => {
            expect(typeof feature.enabled, `${feature.id} enabled`).toBe("boolean");
        });
    });

    it("Every declared category must be a native category listed in the docs", () => {
        FEATURES.forEach((feature) => {
            feature.category.forEach((category) => {
                expect(FEATURE_CATEGORIES).toContain(category);
            });
        });
    });

    it("name and description are i18n keys present in every locale file", () => {
        const locales = LOCALE_FILES.map((file) => [file, readI18n(file)] as const);
        FEATURES.forEach((feature) => {
            [feature.name, feature.description].filter(Boolean).forEach((key) => {
                locales.forEach(([file, data]) => {
                    expect(data[key as string], `${feature.id} is missing ${key} in ${file}`).toBeTruthy();
                });
            });
        });
    });
});

describe("Switch conventions", () => {
    it("A feature without isEnabled must have an enabled switch whose default follows its declaration", () => {
        FEATURES.filter((feature) => !feature.isEnabled).forEach((feature) => {
            const toggle = feature.settings.find((field) => field.kind === "switch" && field.key === "enabled");
            expect(toggle, `${feature.id} is missing an enabled switch`).toBeDefined();
            expect(toggle).toMatchObject({kind: "switch", key: "enabled", default: feature.defaultOn === true});
        });
    });

    it("A declared isEnabled must be a function", () => {
        FEATURES.filter((feature) => feature.isEnabled).forEach((feature) => {
            expect(typeof feature.isEnabled).toBe("function");
        });
    });

    it("Every feature has at least one setting", () => {
        FEATURES.forEach((feature) => {
            expect(feature.settings.length, `${feature.id} has no settings`).toBeGreaterThan(0);
        });
    });

    it("Setting keys are unique and every control kind is known", () => {
        const kinds = ["switch", "text", "textarea", "number", "select", "note", "button"];
        FEATURES.forEach((feature) => {
            const keys = feature.settings.map((field) => field.key);
            expect(new Set(keys).size, `${feature.id} has duplicate keys`).toBe(keys.length);
            feature.settings.forEach((field) => {
                expect(kinds).toContain(field.kind);
            });
        });
    });
});

describe("Lookups", () => {
    it("featureById finds an existing feature", () => {
        const first = FEATURES[0];
        expect(featureById(first.id)).toBe(first);
    });

    it("featureById returns undefined when nothing matches", () => {
        expect(featureById("no-such-feature")).toBeUndefined();
    });

    it("featuresOf returns only that category, in registration order", () => {
        const editor = featuresOf("editor");
        expect(editor.length).toBeGreaterThan(0);
        editor.forEach((feature) => {
            expect(feature.category).toContain("editor");
        });
        const expected = FEATURES.filter((feature) => feature.category.includes("editor"));
        expect(editor).toEqual(expected);
    });

    it("All categories together cover every feature", () => {
        const collected = FEATURE_CATEGORIES.flatMap((category) => featuresOf(category));
        // 一个功能可以同时属于多个分类，所以按 id 去重后与注册表对齐，而不是按出现次数
        expect([...new Set(collected.map((feature) => feature.id))].sort())
            .toEqual(FEATURES.map((feature) => feature.id).sort());
    });

    it("defineFeature turns a single category into a one-item list and drops duplicates", () => {
        const base = FEATURES[0];
        expect(defineFeature({...base, category: "editor"}).category).toEqual(["editor"]);
        expect(defineFeature({...base, category: ["editor", "editor", "ai"]}).category).toEqual(["editor", "ai"]);
        // 声明视图里永远是数组，所以下游不必再区分「一个还是多个」
        expect(defineFeature({...base, category: ["appearance"]}).category).toEqual(["appearance"]);
    });

    it("Tab order is FEATURE_CATEGORIES itself", () => {
        expect(categoryOrder).toBe(FEATURE_CATEGORIES);
    });
});

describe("the effective declaration view", () => {
    /** 只改一个功能的声明视图，其余原样引用。 */
    const withFeature = (id: string, extra: Partial<FeatureDefinition>): FeatureDefinition[] =>
        FEATURES.map((feature) => feature.id === id ? {...feature, ...extra} : feature);

    it("is the source declarations until a patch replaces it as a whole", () => {
        expect(effectiveFeatures()).toBe(FEATURES);

        try {
            setEffectiveFeatures(withFeature("log-output", {enabled: false}));
            // 装载、面板、搜索读的都是这一份：关掉之后它立刻不在生效清单里
            expect(activeFeatures().map((feature) => feature.id)).not.toContain("log-output");
            expect(featureById("log-output")?.enabled).toBe(false);
            // 源码声明本身一个字段都没动，随时能整份退回
            expect(FEATURES[0].enabled).toBe(true);
        } finally {
            resetEffectiveFeatures();
        }

        expect(effectiveFeatures()).toBe(FEATURES);
        expect(activeFeatures().map((feature) => feature.id)).toContain("log-output");
    });

    it("uses the patched category for the panel tabs and the search groups", () => {
        try {
            setEffectiveFeatures(withFeature("log-output", {category: ["editor"]}));
            expect(featuresOf("editor").map((feature) => feature.id)).toContain("log-output");
            expect(featuresOf("plugin").map((feature) => feature.id)).not.toContain("log-output");
        } finally {
            resetEffectiveFeatures();
        }
    });

    it("puts a feature declared in several categories into every one of them", () => {
        try {
            setEffectiveFeatures(withFeature("log-output", {category: ["editor", "appearance"]}));
            expect(featuresOf("editor").map((feature) => feature.id)).toContain("log-output");
            expect(featuresOf("appearance").map((feature) => feature.id)).toContain("log-output");
            expect(featuresOf("plugin").map((feature) => feature.id)).not.toContain("log-output");
        } finally {
            resetEffectiveFeatures();
        }
    });
});

describe("activeFeatures", () => {
    it("Desktop excludes mobile-only features", () => {
        mockState.frontend = "desktop";
        const ids = activeFeatures().map((feature) => feature.id);
        expect(ids).toContain("modal-blur");
        expect(ids).not.toContain("mobile-sync-button");
    });

    it("Mobile excludes desktop-only features", () => {
        mockState.frontend = "mobile";
        const ids = activeFeatures().map((feature) => feature.id);
        expect(ids).toContain("mobile-sync-button");
        expect(ids).not.toContain("devtools-hotkey");
    });

    it("A feature drops out once the host version leaves its range", () => {
        // mobile-select-native 声明了 maxAppVersion: "3.8.7-alpha.2"
        mockState.frontend = "mobile";
        window.siyuan.config.system.kernelVersion = "3.8.7-alpha.1";
        expect(activeFeatures().map((feature) => feature.id)).toContain("mobile-select-native");

        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(activeFeatures().map((feature) => feature.id)).not.toContain("mobile-select-native");
    });

    it("A feature declared enabled: false never takes effect, even with a matching frontend and version", () => {
        const retired: FeatureDefinition = {
            id: "retired-demo",
            category: ["editor"],
            name: "demo.name",
            enabled: false,
            settings: [{kind: "switch", key: "enabled", title: "demo.t", default: false}],
        };
        FEATURES.push(retired);
        try {
            expect(activeFeatures().map((feature) => feature.id)).not.toContain("retired-demo");
        } finally {
            FEATURES.pop();
        }
    });

    it("Active features are enabled, fit the current frontend and stay inside their version range", () => {
        mockState.frontend = "desktop";
        window.siyuan.config.system.kernelVersion = "3.8.7";
        const active = new Set(activeFeatures().map((feature) => feature.id));
        active.forEach((id) => {
            const feature = featureById(id);
            expect(feature?.enabled).toBe(true);
            if (feature?.frontends?.length) {
                expect(feature.frontends).toContain("desktop");
            }
        });
        // 本宿主版本（3.8.7）在 3.8.10-alpha.1 之前，那几个「上游已实现就退场」的功能仍然生效
        expect(active.has("doc-tree-title-markdown")).toBe(true);
        // 与「enabled、适用桌面端且在支持区间内」的手工筛选完全一致
        expect(active.size).toBe(
            FEATURES.filter((feature) =>
                feature.enabled &&
                (!feature.frontends || feature.frontends.includes("desktop")) &&
                supportsCurrentHost(feature)
            ).length,
        );
    });
});
