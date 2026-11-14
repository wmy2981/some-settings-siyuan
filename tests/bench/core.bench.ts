/**
 * 纯逻辑热路径基准。
 *
 * 这几个函数都在「打开面板 / 每敲一个字符」的路径上：面板渲染要转义几百段文案，
 * 搜索每输入一次就要把整个索引匹配一遍。数字的意义是两版代码互相比较，
 * 不是绝对性能指标。
 */
import {
    describe,
    it,
} from "vitest";
import {
    defaultConfig,
    normalizeConfig,
    sameConfig,
} from "../../src/core/config";
import {categoryKey} from "../../src/core/i18n-key";
import {FEATURES} from "../../src/core/registry";
import {
    fieldOf,
    highlightSegments,
    matchIndex,
} from "../../src/core/search";
import type {
    SearchField,
    SearchIndex,
} from "../../src/core/search";
import {
    addStyle,
    removeStylesOf,
} from "../../src/core/style";
import type {
    FeatureConfig,
    SettingField,
} from "../../src/core/types";
import {
    compareVersion,
    parseVersion,
} from "../../src/core/version";
import enLocale from "../../src/i18n/en.json";
import zhLocale from "../../src/i18n/zh-CN.json";
import zhTWLocale from "../../src/i18n/zh-TW.json";
import {
    measure,
    printRows,
} from "./harness";
import type {BenchRow} from "./harness";

const en = enLocale as Record<string, string>;
const zh = zhLocale as Record<string, string>;
const zhTW = zhTWLocale as Record<string, string>;

/** 与面板的索引构造同形：一个字段的若干语言版本（`fieldOf` 负责去重）。 */
const staticField = (key: string): SearchField => fieldOf(zh[key], zhTW[key], en[key]);

/** 面板实际会生成的那份索引（42 个功能、每个功能十几个字段）。 */
const buildIndex = (): SearchIndex => {
    const categories: Record<string, SearchField> = {};
    const features = FEATURES.map((feature) => {
        categories[feature.category] = staticField(categoryKey(feature.category));
        const fields: SearchField[] = [fieldOf(feature.id), staticField(feature.name)];
        if (feature.description) {
            fields.push(staticField(feature.description));
        }
        feature.settings.forEach((field) => {
            fields.push(fieldOf(field.key));
            if (field.kind === "note") {
                fields.push(fieldOf(...Object.values(field.values ?? {}), ...Object.values(field.labels ?? {})));
                return;
            }
            fields.push(staticField(field.title));
            if (field.description) {
                fields.push(staticField(field.description));
            }
            if (field.kind === "text" && field.placeholder) {
                fields.push(staticField(field.placeholder));
            }
            if (field.kind === "select" && !field.optionsProvider) {
                (field.options ?? []).forEach((option) => fields.push(staticField(option.label)));
            }
            if (field.kind === "button" && typeof field.label === "string") {
                fields.push(staticField(field.label));
            }
        });
        return {category: feature.category, id: feature.id, fields};
    });
    return {categories, features};
};

const SETTINGS: SettingField[] = [
    {kind: "switch", key: "enabled", title: "x.enabled", default: false},
    {kind: "number", key: "size", title: "x.size", default: 12, min: 8, max: 24},
    {kind: "text", key: "label", title: "x.label", placeholder: "x.ph", default: "hi"},
    {
        kind: "select",
        key: "mode",
        title: "x.mode",
        default: "auto",
        options: [{value: "auto", label: "x.auto"}, {value: "manual", label: "x.manual"}],
    },
    {kind: "button", key: "run", title: "x.run", label: "x.run", onClick: () => undefined},
    {kind: "note", key: "about", text: "x.about"},
    {kind: "switch", key: "extra", title: "x.extra", default: true},
    {kind: "number", key: "gap", title: "x.gap", default: 4, min: 0, max: 40},
];

const CONFIG: FeatureConfig = defaultConfig(SETTINGS);

describe("core hot paths", () => {
    it("prints the benchmark table", () => {
        const rows: BenchRow[] = [];
        const index = buildIndex();
        const escapeTarget = '面板文案 <div class="b3-label">"图片压缩" & \'image\' — some-settings-siyuan</div>';

        rows.push(
            measure("escapeHtml(120 chars)", () => {
                escapeTarget.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            }, {iterations: 20_000}),
        );
        rows.push(
            measure("matchIndex(1 keyword)", () => {
                matchIndex(index, ["image"]);
            }, {iterations: 200}),
        );
        rows.push(
            measure("matchIndex(3 keywords)", () => {
                matchIndex(index, ["图片", "压缩", "设置"]);
            }, {iterations: 200}),
        );
        rows.push(
            measure("matchIndex(no hit)", () => {
                matchIndex(index, ["zzzz-not-found"]);
            }, {iterations: 200}),
        );
        rows.push(
            measure("highlightSegments(60 chars, 2 hits)", () => {
                highlightSegments("图片压缩 image compress — 设置面板里的一个说明文案", ["image", "压缩"]);
            }, {iterations: 20_000}),
        );
        rows.push(
            measure("normalizeConfig(8 fields)", () => {
                normalizeConfig(SETTINGS, CONFIG);
            }, {iterations: 20_000}),
        );
        rows.push(
            measure("sameConfig(8 fields)", () => {
                sameConfig(CONFIG, CONFIG);
            }, {iterations: 20_000}),
        );
        rows.push(
            measure("parseVersion + compareVersion", () => {
                const host = parseVersion("3.8.7-alpha.2");
                compareVersion(host, parseVersion("3.8.7"));
            }, {iterations: 20_000}),
        );

        const css = "/* 样式表重复注入是配置驱动的常态 */\n.x { color: red; }";
        rows.push(
            measure("addStyle(repeat, same owner)", () => {
                addStyle("bench", css);
            }, {iterations: 5_000, rounds: 5}),
        );
        removeStylesOf("bench");

        printRows("core hot paths", rows);
    });
});
