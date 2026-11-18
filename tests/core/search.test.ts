/**
 * `core/search.ts`：面板搜索的纯逻辑。
 *
 * 搜什么、怎么算命中、命中的文字怎么切出来，都在这里定死 —— 面板只管把结果画到 DOM 上。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import {
    fieldOf,
    highlightSegments,
    isSearchEnabled,
    matchField,
    matchIndex,
    parseQuery,
    setSearchEnabled,
} from "../../src/core/search";
import type {SearchIndex} from "../../src/core/search";

describe("parseQuery", () => {
    it("Trims the query and splits it on whitespace", () => {
        expect(parseQuery("  图片  压缩 ")).toEqual(["图片", "压缩"]);
    });

    it("Counts the full-width space and newlines as separators", () => {
        expect(parseQuery("图片\u3000压缩\n尺寸")).toEqual(["图片", "压缩", "尺寸"]);
    });

    it("Lowercases everything, so English matching ignores case", () => {
        expect(parseQuery("Image PNG")).toEqual(["image", "png"]);
    });

    it("Whitespace alone is an empty search", () => {
        expect(parseQuery("")).toEqual([]);
        expect(parseQuery("   ")).toEqual([]);
        expect(parseQuery("\u3000")).toEqual([]);
    });
});

describe("fieldOf", () => {
    it("Drops empty values and duplicate language versions", () => {
        expect(fieldOf("图片", undefined, "", "  ", "image", "图片")).toEqual(["图片", "image"]);
    });

    it("Trims the value", () => {
        expect(fieldOf("  压缩 ")).toEqual(["压缩"]);
    });
});

describe("matchField", () => {
    it("Matches a single keyword as a contiguous substring", () => {
        expect(matchField(["图片压缩"], parseQuery("压缩"))).toBe(true);
        expect(matchField(["图片压缩"], parseQuery("图压"))).toBe(false);
    });

    it("Ignores case for English", () => {
        expect(matchField(["Compress images"], parseQuery("COMPRESS"))).toBe(true);
    });

    it("Multiple keywords are ANDed in any order", () => {
        expect(matchField(["图片压缩"], parseQuery("压缩 图片"))).toBe(true);
        expect(matchField(["图片压缩"], parseQuery("图片 音频"))).toBe(false);
    });

    it("Chinese and English versions of one field form a single match domain, so keywords can land on either", () => {
        const field = fieldOf("图片压缩", "compress images");
        expect(matchField(field, parseQuery("image 压缩"))).toBe(true);
    });

    it("Concatenating language versions never fakes a hit", () => {
        // 拼起来的匹配域不能把「英文版结尾」和「中文版开头」连成一个词
        const field = fieldOf("abc", "def");
        expect(matchField(field, parseQuery("cd"))).toBe(false);
    });

    it("An empty field or an empty query is not a hit", () => {
        expect(matchField([], parseQuery("图片"))).toBe(false);
        expect(matchField(["图片"], [])).toBe(false);
    });
});

describe("matchIndex", () => {
    const index: SearchIndex = {
        categories: {
            editor: fieldOf("编辑器", "Editor"),
            appearance: fieldOf("外观"),
        },
        features: [
            {category: "editor", id: "alpha", fields: [fieldOf("alpha"), fieldOf("图片压缩")]},
            {category: "editor", id: "beta", fields: [fieldOf("beta"), fieldOf("导出配置")]},
            {category: "appearance", id: "gamma", fields: [fieldOf("gamma"), fieldOf("弹窗模糊")]},
        ],
    };

    it("A field hit marks only that feature", () => {
        const hits = matchIndex(index, parseQuery("压缩"));
        expect([...hits.features]).toEqual(["alpha"]);
        expect([...hits.categories]).toEqual([]);
    });

    it("Internal ids are searchable too", () => {
        expect([...matchIndex(index, parseQuery("BETA")).features]).toEqual(["beta"]);
    });

    it("A category hit marks the category and leaves listing its features to the caller", () => {
        const hits = matchIndex(index, parseQuery("editor"));
        expect([...hits.categories]).toEqual(["editor"]);
        // 分类命中的分类不连带把每个功能都塞进 features —— 两件事分开表达
        expect([...hits.features]).toEqual([]);
    });

    it("Keywords must land on the same field and never combine across fields", () => {
        // 「压缩」在 alpha 的一个字段，「导出」在 beta 的另一个功能里
        const hits = matchIndex(index, parseQuery("压缩 导出"));
        expect([...hits.features]).toEqual([]);
    });

    it("An empty query matches nothing", () => {
        const hits = matchIndex(index, []);
        expect(hits.features.size).toBe(0);
        expect(hits.categories.size).toBe(0);
    });
});

describe("highlightSegments", () => {
    it("Returns the text as a single untouched segment without a hit", () => {
        expect(highlightSegments("图片压缩", parseQuery("音频"))).toEqual([{text: "图片压缩", hit: false}]);
    });

    it("Highlights several keywords inside one text separately", () => {
        expect(highlightSegments("图片压缩，导出与图片", parseQuery("图片 导出"))).toEqual([
            {text: "图片", hit: true},
            {text: "压缩，", hit: false},
            {text: "导出", hit: true},
            {text: "与", hit: false},
            {text: "图片", hit: true},
        ]);
    });

    it("Merges overlapping and adjacent hits into one segment", () => {
        expect(highlightSegments("image", parseQuery("ima image"))).toEqual([{text: "image", hit: true}]);
    });

    it("Locates on the lowercase copy and slices the original, so highlighting keeps the text as written", () => {
        expect(highlightSegments("Compress Images", parseQuery("images"))).toEqual([
            {text: "Compress ", hit: false},
            {text: "Images", hit: true},
        ]);
    });

    it("A hit covering everything yields a single segment", () => {
        expect(highlightSegments("图片压缩", parseQuery("图片压缩"))).toEqual([{text: "图片压缩", hit: true}]);
    });

    it("Handles empty text and an empty query", () => {
        expect(highlightSegments("", parseQuery("图片"))).toEqual([{text: "", hit: false}]);
        expect(highlightSegments("图片", [])).toEqual([{text: "图片", hit: false}]);
    });
});

describe("search availability", () => {
    afterEach(() => setSearchEnabled(false));

    it("Is off until the settings-search feature mounts", () => {
        expect(isSearchEnabled()).toBe(false);
        setSearchEnabled(true);
        expect(isSearchEnabled()).toBe(true);
        setSearchEnabled(false);
        expect(isSearchEnabled()).toBe(false);
    });
});
