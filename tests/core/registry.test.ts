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
import {LOG_FEATURE_ID} from "../../src/core/log";
import {
    activeFeatures,
    ALL_FEATURE_IDS,
    categoryOrder,
    FEATURES,
    featureById,
    featuresOf,
} from "../../src/core/registry";
import {FEATURE_CATEGORIES} from "../../src/core/types";
import type {FeatureDefinition} from "../../src/core/types";
import {mockState} from "../mocks/siyuan";

const ROOT = path.join(__dirname, "..", "..");
const readI18n = (file: string): Record<string, string> =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "src", "i18n", file), "utf8")) as Record<string, string>;

describe("清单本身", () => {
    it("「日志输出」排在第一位：装载器靠它先把详细日志开关打开", () => {
        // 装载器按数组顺序注册 / 挂载，排在后面的话它前面那些功能的装载日志会被开关吞掉
        expect(FEATURES[0].id).toBe(LOG_FEATURE_ID);
        expect(FEATURES[0].enabled).toBe(true);
    });

    it("id 唯一", () => {
        const ids = FEATURES.map((feature) => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("id 只用小写字母、数字与连字符", () => {
        FEATURES.forEach((feature) => {
            expect(feature.id).toMatch(/^[a-z0-9-]+$/);
        });
    });

    it("每个 id 都有同名功能目录", () => {
        FEATURES.forEach((feature) => {
            const entry = path.join(ROOT, "src", "features", feature.id, "index.ts");
            expect(fs.existsSync(entry), `missing ${entry}`).toBe(true);
        });
    });

    it("ALL_FEATURE_IDS 与 FEATURES 同序同内容", () => {
        expect(ALL_FEATURE_IDS).toEqual(FEATURES.map((feature) => feature.id));
    });

    it("enabled 必须显式写 true / false", () => {
        FEATURES.forEach((feature) => {
            expect(typeof feature.enabled, `${feature.id} 的 enabled`).toBe("boolean");
        });
    });

    it("分类必须是文档列出的原生功能区", () => {
        FEATURES.forEach((feature) => {
            expect(FEATURE_CATEGORIES).toContain(feature.category);
        });
    });

    it("name / description 是 i18n key，两份语言文件都有", () => {
        const en = readI18n("en.json");
        const zh = readI18n("zh-CN.json");
        FEATURES.forEach((feature) => {
            [feature.name, feature.description].filter(Boolean).forEach((key) => {
                expect(en[key as string], `${feature.id} 缺英文 ${key}`).toBeTruthy();
                expect(zh[key as string], `${feature.id} 缺中文 ${key}`).toBeTruthy();
            });
        });
    });
});

describe("开关约定", () => {
    it("没有 isEnabled 的功能必须有一个默认关闭的 enabled 开关", () => {
        FEATURES.filter((feature) => !feature.isEnabled).forEach((feature) => {
            const toggle = feature.settings.find((field) => field.kind === "switch" && field.key === "enabled");
            expect(toggle, `${feature.id} 缺 enabled 开关`).toBeDefined();
            expect(toggle).toMatchObject({kind: "switch", key: "enabled", default: false});
        });
    });

    it("声明了 isEnabled 的必须是函数", () => {
        FEATURES.filter((feature) => feature.isEnabled).forEach((feature) => {
            expect(typeof feature.isEnabled).toBe("function");
        });
    });

    it("每个功能都至少有一个设置项", () => {
        FEATURES.forEach((feature) => {
            expect(feature.settings.length, `${feature.id} 没有设置项`).toBeGreaterThan(0);
        });
    });

    it("设置项的 key 不重复，控件类型是已知的", () => {
        const kinds = ["switch", "text", "textarea", "number", "select", "note", "button"];
        FEATURES.forEach((feature) => {
            const keys = feature.settings.map((field) => field.key);
            expect(new Set(keys).size, `${feature.id} 的 key 有重复`).toBe(keys.length);
            feature.settings.forEach((field) => {
                expect(kinds).toContain(field.kind);
            });
        });
    });
});

describe("查询", () => {
    it("featureById 找到已有功能", () => {
        const first = FEATURES[0];
        expect(featureById(first.id)).toBe(first);
    });

    it("featureById 找不到时返回 undefined", () => {
        expect(featureById("no-such-feature")).toBeUndefined();
    });

    it("featuresOf 只返回该分类，且保持注册顺序", () => {
        const editor = featuresOf("editor");
        expect(editor.length).toBeGreaterThan(0);
        editor.forEach((feature) => {
            expect(feature.category).toBe("editor");
        });
        const expected = FEATURES.filter((feature) => feature.category === "editor");
        expect(editor).toEqual(expected);
    });

    it("各分类加起来正好是全部功能", () => {
        const collected = FEATURE_CATEGORIES.flatMap((category) => featuresOf(category));
        expect(collected).toHaveLength(FEATURES.length);
        expect(collected.map((feature) => feature.id).sort()).toEqual(FEATURES.map((feature) => feature.id).sort());
    });

    it("页签顺序直接用 FEATURE_CATEGORIES", () => {
        expect(categoryOrder).toBe(FEATURE_CATEGORIES);
    });
});

describe("activeFeatures", () => {
    it("桌面端不包含只在移动端的功能", () => {
        mockState.frontend = "desktop";
        const ids = activeFeatures().map((feature) => feature.id);
        expect(ids).toContain("modal-blur");
        expect(ids).not.toContain("mobile-sync-button");
    });

    it("移动端不包含只在桌面端的功能", () => {
        mockState.frontend = "mobile";
        const ids = activeFeatures().map((feature) => feature.id);
        expect(ids).toContain("mobile-sync-button");
        expect(ids).not.toContain("devtools-hotkey");
    });

    it("宿主版本超出支持区间时该功能不再生效", () => {
        // mobile-select-native 声明了 maxAppVersion: "3.8.7-alpha.2"
        mockState.frontend = "mobile";
        window.siyuan.config.system.kernelVersion = "3.8.7-alpha.1";
        expect(activeFeatures().map((feature) => feature.id)).toContain("mobile-select-native");

        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(activeFeatures().map((feature) => feature.id)).not.toContain("mobile-select-native");
    });

    it("声明 enabled: false 的功能不生效（前端与版本都符合也不行）", () => {
        const retired: FeatureDefinition = {
            id: "retired-demo",
            category: "editor",
            name: "demo.name",
            enabled: false,
            settings: [{kind: "switch", key: "enabled", title: "demo.t", default: false}],
        };
        FEATURES.push(retired);
        try {
            expect(activeFeatures().map((feature) => feature.id)).not.toContain("retired-demo");
            expect(ALL_FEATURE_IDS).not.toContain("retired-demo");
        } finally {
            FEATURES.pop();
        }
    });

    it("生效的功能一定是 enabled、适用于当前前端且在支持区间内的", () => {
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
        // 与「enabled 且适用桌面端」的手工筛选完全一致
        expect(active.size).toBe(
            FEATURES.filter((feature) =>
                feature.enabled &&
                (!feature.frontends?.length || feature.frontends.includes("desktop"))
            ).length,
        );
    });
});
