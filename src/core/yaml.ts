/**
 * 最小 YAML 子集解析。
 *
 * 只服务插件私有目录里那份用户手写的声明补丁（`data/storage/petal/<插件名>/.patch.yml`），
 * 不是通用 YAML 实现。刻意只认这个文件真正用得上的写法，遇到别的语法一律报错 ——
 * 报错带行号，会进 WARN 日志、并让整份补丁作废（见 `core/patch.ts`）。
 * 「看不懂就当没写」是最坏的选择：用户会以为补丁生效了，实际用的还是内置声明。
 *
 * 支持：
 * - 块状映射 `key: value`，缩进只用空格，嵌套靠缩进表明；
 * - 值：空值（`key:`、`null`、`~`）、`true` / `false`、纯文本、单引号与双引号字符串、
 *   行内数组 `[a, b]`、空映射 `{}`、块状列表（每行一项 `- a`，只放标量）；
 * - 注释：整行 `# …`，以及值后面隔了空白的 ` # …`（引号里的 `#` 不算注释）。
 *
 * 不支持（出现即报错）：锚点与别名（`&` / `*`）、多文档（`---`）、块标量（`|` / `>`）、
 * 标签（`!!`）、`{}` 之外的行内映射、多行纯文本、Tab 缩进、`yes` / `no` / `on` / `off`
 * 这类有歧义的布尔写法（要写 `true` / `false`）。
 *
 * 返回值的形状只有 JSON 能表达的那几种；字段取值合不合法是调用方的事，
 * 这里只负责「文件能不能读成一份结构」。
 */

/** 解析出来的一棵值树。 */
export type YamlValue = string | boolean | null | YamlValue[] | YamlMapping;

/** 一份映射。键一定是纯文本键，值是任意 `YamlValue`。 */
export interface YamlMapping {
    [key: string]: YamlValue;
}

export type YamlParse =
    | {kind: "ok"; value: YamlMapping;}
    | {kind: "error"; detail: string;};

/** 解析中途的失败：只有带行号的原因，原始内容一律不进日志。 */
class YamlError extends Error {}

const reject = (line: number, message: string): never => {
    throw new YamlError(`line ${line}: ${message}`);
};

/** 一行有效内容：缩进宽度、去掉注释与首尾空白后的正文、行号（报错用）。 */
interface YamlLine {
    indent: number;
    text: string;
    number: number;
}

/** 游标：`readLines()` 之后整份文件的读取位置，块与块之间共用。 */
interface Cursor {
    index: number;
}

/** 这些写法在不同 YAML 版本里含义不同，与其猜，不如让用户写清楚。 */
const AMBIGUOUS_BOOLEANS = ["yes", "no", "on", "off"];

/** 双引号字符串里支持的转义。 */
const ESCAPES: Record<string, string> = {
    "\\": "\\",
    '"': '"',
    "'": "'",
    n: "\n",
    r: "\r",
    t: "\t",
};

/**
 * 去掉这一行的注释。
 *
 * 只在引号外面、且 `#` 前面是空白（或整行开头）时才算注释 —— `#fff` 这种以 `#` 开头的
 * 颜色值、引号里的 `#` 都是正文。单引号里的 `''` 会先结束再重新开始，注释判定不受影响。
 */
const stripComment = (line: string): string => {
    let quote: string | undefined;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quote === '"') {
            if (char === "\\") {
                index += 1;
            } else if (char === '"') {
                quote = undefined;
            }
            continue;
        }
        if (quote === "'") {
            if (char === "'") {
                quote = undefined;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
            return line.slice(0, index);
        }
    }
    return line;
};

/** 把整份文本切成有效行：空行与纯注释行直接丢掉，缩进只允许空格。 */
const readLines = (text: string): YamlLine[] => {
    const lines: YamlLine[] = [];
    const raw = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
    raw.forEach((original, index) => {
        const number = index + 1;
        const withoutComment = stripComment(original);
        if (withoutComment.trim() === "") {
            return;
        }
        const indentation = /^[ \t]*/.exec(withoutComment)?.[0] ?? "";
        if (indentation.includes("\t")) {
            reject(number, "indentation must use spaces, not tabs");
        }
        const content = withoutComment.slice(indentation.length).trim();
        // 多文档标记整行就是一段分隔符，先在这里拦下，免得被当成读不懂的键
        if (content === "---" || content === "...") {
            reject(number, "multi-document markers are not supported");
        }
        lines.push({indent: indentation.length, text: content, number});
    });
    return lines;
};

const isMapping = (value: YamlValue): value is YamlMapping =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isSequenceItem = (text: string): boolean => text === "-" || text.startsWith("- ");

/** 一段文字是不是 `key: value` 形式的映射条目（用于在列表里识别不支持的嵌套写法）。 */
const looksLikeEntry = (text: string): boolean => /^[A-Za-z0-9_.-]+[ ]*:([ ]|$)/.test(text);

/** 拆一个映射条目：键只允许字母、数字、下划线、点与连字符，冒号后要么结束要么跟一个空格。 */
const splitEntry = (line: YamlLine): {key: string; rest: string;} => {
    const match = /^([A-Za-z0-9_.-]+)[ ]*:(?:[ ]+(.*))?$/.exec(line.text);
    if (!match) {
        reject(line.number, `cannot read "${line.text}" as "key: value"`);
    }
    return {key: match[1], rest: (match[2] ?? "").trim()};
};

/** 双引号字符串的转义还原；未定义的转义直接报错，不猜。 */
const unescapeDouble = (body: string, line: YamlLine): string => {
    let result = "";
    for (let index = 0; index < body.length; index += 1) {
        const char = body[index];
        if (char !== "\\") {
            result += char;
            continue;
        }
        const escaped = body[index + 1];
        const mapped = typeof escaped === "string" ? ESCAPES[escaped] : undefined;
        if (typeof mapped === "undefined") {
            reject(line.number, `unsupported escape "\\${escaped ?? ""}"`);
        }
        result += mapped;
        index += 1;
    }
    return result;
};

/** 一个标量：空值、布尔、引号字符串或纯文本。 */
const parseScalar = (text: string, line: YamlLine): YamlValue => {
    if (text.startsWith('"')) {
        if (text.length < 2 || !text.endsWith('"')) {
            reject(line.number, "unterminated double-quoted string");
        }
        return unescapeDouble(text.slice(1, -1), line);
    }
    if (text.startsWith("'")) {
        if (text.length < 2 || !text.endsWith("'")) {
            reject(line.number, "unterminated single-quoted string");
        }
        return text.slice(1, -1).replace(/''/g, "'");
    }
    const lowered = text.toLowerCase();
    if (lowered === "null" || text === "~") {
        return null;
    }
    if (lowered === "true") {
        return true;
    }
    if (lowered === "false") {
        return false;
    }
    if (AMBIGUOUS_BOOLEANS.includes(lowered)) {
        reject(line.number, `"${text}" is ambiguous; write true or false`);
    }
    if (text.startsWith("|") || text.startsWith(">")) {
        reject(line.number, "block scalars are not supported");
    }
    if (text.startsWith("&") || text.startsWith("*")) {
        reject(line.number, "anchors and aliases are not supported");
    }
    if (text.startsWith("!")) {
        reject(line.number, "tags are not supported");
    }
    if (text === "---" || text === "...") {
        reject(line.number, "multi-document markers are not supported");
    }
    return text;
};

/** 行内数组 `[a, b]`：只放标量，不支持嵌套。 */
const parseInlineSequence = (text: string, line: YamlLine): YamlValue[] => {
    if (!text.endsWith("]")) {
        reject(line.number, 'an inline list must end with "]"');
    }
    const body = text.slice(1, -1).trim();
    if (body === "") {
        return [];
    }
    const parts: string[] = [];
    let current = "";
    let quote: string | undefined;
    for (let index = 0; index < body.length; index += 1) {
        const char = body[index];
        if (quote) {
            current += char;
            if (quote === '"' && char === "\\") {
                const escaped = body[index + 1];
                if (typeof escaped === "string") {
                    current += escaped;
                    index += 1;
                }
                continue;
            }
            if (char === quote) {
                quote = undefined;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === ",") {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    if (quote) {
        reject(line.number, "unterminated quoted string in the inline list");
    }
    parts.push(current);
    return parts.map((part) => {
        const item = part.trim();
        if (item === "") {
            reject(line.number, "empty item in the inline list");
        }
        if (item.startsWith("[") || item.startsWith("{")) {
            reject(line.number, "nested collections are not supported in a list");
        }
        return parseScalar(item, line);
    });
};

/** 冒号右边那一小段：空映射、行内数组或标量。 */
const parseInlineValue = (text: string, line: YamlLine): YamlValue => {
    if (text === "") {
        return null;
    }
    if (text === "{}") {
        return {};
    }
    if (text === "[]") {
        return [];
    }
    if (text.startsWith("[")) {
        return parseInlineSequence(text, line);
    }
    if (text.startsWith("{")) {
        reject(line.number, "flow mappings other than {} are not supported");
    }
    return parseScalar(text, line);
};

/** 一块映射：同级条目一行一个，更深缩进的行属于上一个键。 */
const parseMapping = (lines: YamlLine[], cursor: Cursor, indent: number): YamlMapping => {
    const mapping: YamlMapping = {};
    while (cursor.index < lines.length) {
        const line = lines[cursor.index];
        if (line.indent < indent) {
            break;
        }
        if (line.indent > indent) {
            reject(line.number, `unexpected indentation (expected ${indent} spaces or fewer)`);
        }
        if (isSequenceItem(line.text)) {
            reject(line.number, "a list item cannot appear here");
        }
        const {key, rest} = splitEntry(line);
        if (Object.prototype.hasOwnProperty.call(mapping, key)) {
            reject(line.number, `duplicate key "${key}"`);
        }
        cursor.index += 1;
        if (rest !== "") {
            mapping[key] = parseInlineValue(rest, line);
            continue;
        }
        const next = lines[cursor.index];
        mapping[key] = next && next.indent > indent ? parseBlock(lines, cursor, next.indent) : null;
    }
    return mapping;
};

/** 一块列表：只认 `- 标量`，嵌套结构与行内映射在这里都不支持。 */
const parseSequence = (lines: YamlLine[], cursor: Cursor, indent: number): YamlValue[] => {
    const items: YamlValue[] = [];
    while (cursor.index < lines.length) {
        const line = lines[cursor.index];
        if (line.indent < indent) {
            break;
        }
        if (line.indent > indent) {
            reject(line.number, `unexpected indentation (expected ${indent} spaces or fewer)`);
        }
        if (!isSequenceItem(line.text)) {
            reject(line.number, 'expected a list item starting with "-"');
        }
        const rest = line.text === "-" ? "" : line.text.slice(1).trim();
        cursor.index += 1;
        if (rest === "") {
            const next = lines[cursor.index];
            items.push(next && next.indent > indent ? parseBlock(lines, cursor, next.indent) : null);
            continue;
        }
        if (looksLikeEntry(rest)) {
            reject(line.number, "only plain values are supported in a list");
        }
        items.push(parseScalar(rest, line));
    }
    return items;
};

const parseBlock = (lines: YamlLine[], cursor: Cursor, indent: number): YamlValue =>
    isSequenceItem(lines[cursor.index].text) ?
        parseSequence(lines, cursor, indent) :
        parseMapping(lines, cursor, indent);

/**
 * 解析一份 YAML 文本。
 *
 * 根节点必须是映射（`{}` 表示空文档）；空文件、只有注释的文件也返回空映射 ——
 * 「没有覆盖」是正常状态，不是错误。
 */
export const parseYaml = (text: string): YamlParse => {
    try {
        const lines = readLines(text);
        if (lines.length === 0) {
            return {kind: "ok", value: {}};
        }
        if (lines[0].indent !== 0) {
            reject(lines[0].number, "the document must start at column 0");
        }
        const cursor: Cursor = {index: 0};
        const value = parseBlock(lines, cursor, 0);
        if (cursor.index !== lines.length) {
            reject(lines[cursor.index].number, "unexpected content");
        }
        if (!isMapping(value)) {
            return {kind: "error", detail: `line ${lines[0].number}: the document must be a mapping of keys to values`};
        }
        return {kind: "ok", value};
    } catch (error) {
        return {
            kind: "error",
            detail: error instanceof Error ? error.message : `cannot parse the document: ${String(error)}`,
        };
    }
};
