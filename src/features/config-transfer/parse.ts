/**
 * 导入文本的解析：把用户粘贴的一段 JSON 变成「功能 id → 配置」。
 *
 * 兼容两种形态：本插件导出的完整文档（带 `features` 字段），以及直接就是
 * `{"<功能 id>": {...}}` 的映射。这里只判定「是不是一份能用的配置对象」；
 * 某个 id 认不认识、某个值合不合法由 `ConfigStore` 判定 —— 解析层不重复那份规则，
 * 否则两份规则迟早会不一致。
 */
export type ImportParse =
    | {kind: "ok"; features: Record<string, unknown>;}
    | {kind: "error"; reason: "json" | "shape";};

/** 值必须是对象才是配置；数组与 null 都不是。 */
const isConfigObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export const parseImport = (text: string): ImportParse => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {kind: "error", reason: "json"};
    }
    if (!isConfigObject(parsed)) {
        return {kind: "error", reason: "shape"};
    }
    if (isConfigObject(parsed.features)) {
        return {kind: "ok", features: parsed.features};
    }
    // 没有 features 字段时按「裸映射」处理；要求每一项都是对象，
    // 免得把 `{"plugin": "...", "version": 1}` 这种头部当成配置写进去
    const entries = Object.entries(parsed);
    if (entries.length > 0 && entries.every(([, value]) => isConfigObject(value))) {
        return {kind: "ok", features: parsed};
    }
    return {kind: "error", reason: "shape"};
};
