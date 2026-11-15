/**
 * `core/search.ts`：面板搜索的纯逻辑。
 *
 * 搜什么、怎么算命中、命中的文字怎么切出来，都在这里定死 —— 面板只管把结果画到 DOM 上。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    fieldOf,
    highlightSegments,
    matchField,
    matchIndex,
    parseQuery,
} from "../../src/core/search";
import type {SearchIndex} from "../../src/core/search";

describe("parseQuery", () => {
    it("去掉首尾空白并按空白拆词", () => {
        expect(parseQuery("  图片  压缩 ")).toEqual(["图片", "压缩"]);
    });

    it("全角空格与换行也算分隔", () => {
        expect(parseQuery("图片\u3000压缩\n尺寸")).toEqual(["图片", "压缩", "尺寸"]);
    });

    it("统一转小写：英文忽略大小写", () => {
        expect(parseQuery("Image PNG")).toEqual(["image", "png"]);
    });

    it("只有空白等于没搜", () => {
        expect(parseQuery("")).toEqual([]);
        expect(parseQuery("   ")).toEqual([]);
        expect(parseQuery("\u3000")).toEqual([]);
    });
});

describe("fieldOf", () => {
    it("丢掉空值与重复的语言版本", () => {
        expect(fieldOf("图片", undefined, "", "  ", "image", "图片")).toEqual(["图片", "image"]);
    });

    it("去掉首尾空白", () => {
        expect(fieldOf("  压缩 ")).toEqual(["压缩"]);
    });
});

describe("matchField", () => {
    it("单个关键词是连续子串匹配", () => {
        expect(matchField(["图片压缩"], parseQuery("压缩"))).toBe(true);
        expect(matchField(["图片压缩"], parseQuery("图压"))).toBe(false);
    });

    it("英文忽略大小写", () => {
        expect(matchField(["Compress images"], parseQuery("COMPRESS"))).toBe(true);
    });

    it("多关键词 AND，顺序不限", () => {
        expect(matchField(["图片压缩"], parseQuery("压缩 图片"))).toBe(true);
        expect(matchField(["图片压缩"], parseQuery("图片 音频"))).toBe(false);
    });

    it("同一个字段的中英文版本算一个匹配域：关键词可以分别落在两种语言上", () => {
        const field = fieldOf("图片压缩", "compress images");
        expect(matchField(field, parseQuery("image 压缩"))).toBe(true);
    });

    it("跨语言版本拼不出假命中", () => {
        // 拼起来的匹配域不能把「英文版结尾」和「中文版开头」连成一个词
        const field = fieldOf("abc", "def");
        expect(matchField(field, parseQuery("cd"))).toBe(false);
    });

    it("空字段或空查询不算命中", () => {
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

    it("字段命中只标出那个功能", () => {
        const hits = matchIndex(index, parseQuery("压缩"));
        expect([...hits.features]).toEqual(["alpha"]);
        expect([...hits.categories]).toEqual([]);
    });

    it("内部 id 也能搜", () => {
        expect([...matchIndex(index, parseQuery("BETA")).features]).toEqual(["beta"]);
    });

    it("分类名命中时标出分类，由调用方显示该分类全部功能", () => {
        const hits = matchIndex(index, parseQuery("editor"));
        expect([...hits.categories]).toEqual(["editor"]);
        // 分类命中的分类不连带把每个功能都塞进 features —— 两件事分开表达
        expect([...hits.features]).toEqual([]);
    });

    it("关键词必须落在同一个字段上：不能跨字段拼", () => {
        // 「压缩」在 alpha 的一个字段，「导出」在 beta 的另一个功能里
        const hits = matchIndex(index, parseQuery("压缩 导出"));
        expect([...hits.features]).toEqual([]);
    });

    it("空查询没有命中", () => {
        const hits = matchIndex(index, []);
        expect(hits.features.size).toBe(0);
        expect(hits.categories.size).toBe(0);
    });
});

describe("highlightSegments", () => {
    it("没有命中时原样返回一段", () => {
        expect(highlightSegments("图片压缩", parseQuery("音频"))).toEqual([{text: "图片压缩", hit: false}]);
    });

    it("同一段文字里的多个关键词分别高亮", () => {
        expect(highlightSegments("图片压缩，导出与图片", parseQuery("图片 导出"))).toEqual([
            {text: "图片", hit: true},
            {text: "压缩，", hit: false},
            {text: "导出", hit: true},
            {text: "与", hit: false},
            {text: "图片", hit: true},
        ]);
    });

    it("重叠与相邻的命中合并成一段", () => {
        expect(highlightSegments("image", parseQuery("ima image"))).toEqual([{text: "image", hit: true}]);
    });

    it("按小写定位、按原文切片：高亮不改文案的样子", () => {
        expect(highlightSegments("Compress Images", parseQuery("images"))).toEqual([
            {text: "Compress ", hit: false},
            {text: "Images", hit: true},
        ]);
    });

    it("命中整段时只有一段", () => {
        expect(highlightSegments("图片压缩", parseQuery("图片压缩"))).toEqual([{text: "图片压缩", hit: true}]);
    });

    it("空文案与空查询都能处理", () => {
        expect(highlightSegments("", parseQuery("图片"))).toEqual([{text: "", hit: false}]);
        expect(highlightSegments("图片", [])).toEqual([{text: "图片", hit: false}]);
    });
});
