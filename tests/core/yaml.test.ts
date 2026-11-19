// @vitest-environment node
/**
 * `core/yaml.ts`：最小 YAML 子集解析。
 *
 * 这份解析器只服务用户手写的那份声明补丁，所以两边都要测：
 * 用得上的写法必须读对（映射、行内 / 块状列表、引号、空值、注释），
 * 用不上的语法必须**报错**而不是悄悄当成字符串 —— 悄悄读错会让整份补丁看起来生效了、
 * 实际语义完全不同。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {parseYaml} from "../../src/core/yaml";

/** 解析成功后的值；解析失败直接让测试失败，省得每处都写 kind 判断。 */
const valueOf = (text: string): unknown => {
    const parsed = parseYaml(text);
    if (parsed.kind !== "ok") {
        throw new Error(`expected a successful parse, got: ${parsed.detail}`);
    }
    return parsed.value;
};

/** 解析失败的原因；解析成功直接让测试失败。 */
const errorOf = (text: string): string => {
    const parsed = parseYaml(text);
    if (parsed.kind !== "error") {
        throw new Error(`expected a failure, got: ${JSON.stringify(parsed.value)}`);
    }
    return parsed.detail;
};

describe("parseYaml: values", () => {
    it("an empty document has no keys", () => {
        expect(valueOf("")).toEqual({});
        expect(valueOf("\n\n   \n")).toEqual({});
        expect(valueOf("# only a comment\n")).toEqual({});
    });

    it("reads nested mappings by indentation", () => {
        expect(valueOf("features:\n  alpha:\n    enabled: false\n    category: editor\n")).toEqual({
            features: {alpha: {enabled: false, category: "editor"}},
        });
    });

    it("reads scalars: booleans, nulls, plain text and quoted strings", () => {
        expect(valueOf("a: true\nb: false\nc: null\nd: ~\ne: hello\nf: \"3.8.7\"\ng: 'it''s'\n")).toEqual({
            a: true,
            b: false,
            c: null,
            d: null,
            e: "hello",
            f: "3.8.7",
            g: "it's",
        });
    });

    it("a key without a value is null, unless a deeper block follows", () => {
        expect(valueOf("features:\n")).toEqual({features: null});
        expect(valueOf("features:\n  alpha:\n")).toEqual({features: {alpha: null}});
    });

    it("reads inline lists, including empty ones", () => {
        expect(valueOf("frontends: [desktop, mobile]")).toEqual({frontends: ["desktop", "mobile"]});
        expect(valueOf("frontends: []")).toEqual({frontends: []});
        expect(valueOf("frontends: [ desktop , 'a,b' ]")).toEqual({frontends: ["desktop", "a,b"]});
    });

    it("reads block lists of plain values", () => {
        expect(valueOf("frontends:\n  - desktop\n  - mobile\n")).toEqual({frontends: ["desktop", "mobile"]});
    });

    it("reads the empty mapping and the empty list", () => {
        expect(valueOf("features: {}")).toEqual({features: {}});
        expect(valueOf("features: []")).toEqual({features: []});
    });

    it("ignores comments but keeps a hash inside quotes and at the start of a value", () => {
        expect(valueOf("# header\na: 1 # trailing\nb: \"x # y\"\nc: '#z'\n")).toEqual({
            a: "1",
            b: "x # y",
            c: "#z",
        });
    });

    it("tolerates CRLF line endings and a BOM", () => {
        expect(valueOf("\uFEFFfeatures:\r\n  alpha:\r\n    enabled: true\r\n")).toEqual({
            features: {alpha: {enabled: true}},
        });
    });
});

describe("parseYaml: rejected syntax", () => {
    it("tabs in the indentation", () => {
        expect(errorOf("features:\n\talpha: 1\n")).toContain("spaces, not tabs");
    });

    it("an indented document", () => {
        expect(errorOf("  features: {}\n")).toContain("must start at column 0");
    });

    it("a line that is neither a mapping entry nor a list item", () => {
        expect(errorOf("features\n")).toContain("cannot read");
    });

    it("a duplicate key", () => {
        expect(errorOf("features: {}\nfeatures: {}\n")).toContain("duplicate key");
    });

    it("an ambiguous boolean", () => {
        expect(errorOf("enabled: yes\n")).toContain("ambiguous");
        expect(errorOf("enabled: off\n")).toContain("ambiguous");
    });

    it("an unterminated string", () => {
        expect(errorOf('a: "unterminated\n')).toContain("unterminated double-quoted string");
        expect(errorOf("a: 'unterminated\n")).toContain("unterminated single-quoted string");
        expect(errorOf('a: "bad \\q escape"\n')).toContain("unsupported escape");
    });

    it("syntax this parser deliberately does not implement", () => {
        expect(errorOf("a: |\n  text\n")).toContain("block scalars");
        expect(errorOf("a: &anchor 1\n")).toContain("anchors and aliases");
        expect(errorOf("a: !!str 1\n")).toContain("tags are not supported");
        expect(errorOf("---\na: 1\n")).toContain("multi-document markers");
        expect(errorOf("a: {b: 1}\n")).toContain("flow mappings");
        expect(errorOf("a:\n  - key: value\n")).toContain("only plain values");
    });

    it("an unterminated or malformed inline list", () => {
        expect(errorOf("frontends: [desktop\n")).toContain("must end with");
        expect(errorOf("frontends: [desktop, ]\n")).toContain("empty item");
        expect(errorOf("frontends: [[desktop]]\n")).toContain("nested collections");
    });

    it("an unexpected indentation", () => {
        expect(errorOf("a: 1\n   b: 2\n")).toContain("unexpected indentation");
    });

    it("a document whose root is a list", () => {
        expect(errorOf("- a\n- b\n")).toContain("must be a mapping");
    });
});
