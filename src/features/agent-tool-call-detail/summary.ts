/**
 * 把一次工具调用压成「内联摘要 + 悬停详情」两段文本。
 *
 * 纯函数：不碰 DOM、不取 i18n，标签由调用方传进来，方便单独读、单独改。
 *
 * 参数是模型自由生成的 JSON，各工具字段名不同（`search` 用 `query`、`block` 用 `id`、
 * `file` 用 `path`……），所以这里不按工具名查表（那会随思源新增工具而失效），
 * 而是按「哪个字段最能说明这一次动了什么」排优先级取一个值：先 `action`，再能定位目标的
 * 短字段，最后才退回声明顺序里的第一个值。内容型大字段（`data`/`content`）排在最后，
 * 因为把它们塞进一行摘要只会把整行撑满。
 *
 * 内核自己注入的内部字段（`_sessionID`、`_toolCallID`）用户看不懂，一律丢掉。
 */

/** 工具调用在会话存档里的样子（只取本功能用得到的字段）。 */
export type ToolCallData = {
    id?: string;
    name: string;
    arguments?: Record<string, unknown>;
    result?: string;
};

/** 悬停详情里的两个标签，由调用方取 i18n。 */
export type ToolCallLabels = {
    args: string;
    result: string;
    noArgs: string;
};

export type ToolCallView = {
    /** 内联摘要：只描述参数，工具名由胶囊自己显示。没有可显示的参数时为空串。 */
    inline: string;
    /** 悬停详情：工具名 + 摘要 + 完整参数 + 结果开头。 */
    tooltip: string;
};

/** 内联摘要里最多显示多少个字符。 */
const INLINE_LIMIT = 44;
/** 悬停详情里参数 JSON 的字符上限。 */
const ARGS_LIMIT = 600;
/** 悬停详情里结果的字符上限。 */
const RESULT_LIMIT = 240;
/** 悬停详情总长上限，避免提示框大得没法读。 */
const TOOLTIP_LIMIT = 1600;

/** 优先做摘要的键：最能说明「这一次操作了什么」。 */
const IDENTIFY_KEYS = [
    "query",
    "keyword",
    "k",
    "q",
    "sql",
    "path",
    "id",
    "ids",
    "notebook",
    "notebookID",
    "title",
    "name",
    "url",
    "tag",
    "ext",
    "type",
    "parentID",
    "blockID",
    "docID",
];
/** 内容型大字段：只有在没有别的可显示时才拿它们兜底。 */
const PAYLOAD_KEYS = ["data", "content", "text", "html", "markdown", "blocks", "children"];

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const elide = (text: string, limit: number): string => text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/** 丢掉内核注入的内部字段，并清掉空值。 */
const visibleArgs = (args?: Record<string, unknown>): Array<[string, unknown]> => {
    if (!args) {
        return [];
    }
    return Object.entries(args).filter(([key, value]) =>
        !key.startsWith("_") && value !== null && value !== undefined && value !== ""
    );
};

/** 单个参数值的短文本；结构化得看不出来的值只报规模。 */
const valueText = (value: unknown): string => {
    if (typeof value === "string") {
        return collapse(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        const scalars = value.filter((item) => item === null || typeof item !== "object");
        return scalars.length === value.length ? collapse(scalars.map(String).join(",")) : `[${value.length}]`;
    }
    return value && typeof value === "object" ? "{…}" : "";
};

/** 一次调用的内联摘要：动作 + 一个定位参数。 */
const argsSummary = (args?: Record<string, unknown>): string => {
    const entries = visibleArgs(args);
    if (entries.length === 0) {
        return "";
    }
    const parts: string[] = [];
    const action = entries.find(([key]) => key === "action");
    if (action) {
        parts.push(valueText(action[1]));
    }
    const rest = entries.filter(([key]) => key !== "action");
    let target = rest.find(([key]) => IDENTIFY_KEYS.includes(key));
    if (!target) {
        target = rest.find(([key]) => !PAYLOAD_KEYS.includes(key));
    }
    if (!target) {
        target = rest[0];
    }
    if (target) {
        parts.push(valueText(target[1]));
    }
    return collapse(parts.filter(Boolean).join(" "));
};

/** 一次调用的完整描述：界面上的摘要 + 悬停时看得到的参数与结果。 */
export const describeToolCall = (call: ToolCallData, labels: ToolCallLabels): ToolCallView => {
    const summary = argsSummary(call.arguments);
    const args = visibleArgs(call.arguments);
    const lines = [[call.name, summary].filter(Boolean).join(" ")];
    lines.push(
        `${labels.args}: ${
            args.length > 0 ? elide(JSON.stringify(Object.fromEntries(args), null, 2), ARGS_LIMIT) : labels.noArgs
        }`,
    );
    if (call.result) {
        lines.push(`${labels.result}: ${elide(collapse(call.result), RESULT_LIMIT)}`);
    }
    return {
        inline: summary ? elide(summary, INLINE_LIMIT) : "",
        tooltip: elide(lines.join("\n"), TOOLTIP_LIMIT),
    };
};

/** 一个胶囊上并了多次调用时的内联摘要。 */
export const mergeInline = (views: ToolCallView[]): string => {
    const parts = views.map((view) => view.inline).filter(Boolean);
    const text = parts.join(" / ");
    const count = views.length > 1 ? `${text ? " " : ""}×${views.length}` : "";
    return elide(`${text}${count}`, INLINE_LIMIT + 12);
};

/** 一个胶囊上并了多次调用时的悬停详情。 */
export const mergeTooltip = (views: ToolCallView[]): string =>
    elide(views.map((view) => view.tooltip).join("\n\n"), TOOLTIP_LIMIT);
