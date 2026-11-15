/**
 * 设置面板全局搜索的纯逻辑。
 *
 * 这里只有数据：解析查询、拼索引、判断命中、把一段可见文案切成「命中 / 未命中」的片段。
 * 面板里的显隐、分类分组、高亮写进 DOM 由 `setting-dialog.ts` 负责 —— 不碰 DOM 的这些规则
 * 才能单独单测。
 *
 * 匹配规则（与 issue #119 一致）：
 * - 去掉首尾空白后按空白拆成多个关键词；只有空白等于没搜
 * - 英文忽略大小写，连续子串匹配；多关键词 AND，顺序不限
 * - **所有关键词必须落在同一个逻辑字段上**。一个字段可以有多份文案（静态 i18n 的各语言版本），
 *   它们合起来算一个匹配域：`image 压缩` 分别命中英文与中文版本也算命中同一个字段；
 *   但「功能名命中图片、设置项命中压缩」不算
 * - 不做拼音、首字母、繁简、全半角、同义词、模糊或正则匹配
 */

/** 一个逻辑字段的匹配域：同一字段的若干份文案（多语言版本）。 */
export type SearchField = readonly string[];

/** 索引里的一条功能记录。 */
export interface SearchRecord {
    /** 功能所属分类 id。 */
    category: string;
    /** 功能 id。 */
    id: string;
    /** 这个功能的全部字段，一个字段一组文案。 */
    fields: SearchField[];
}

/** 只读索引：面板当前展示的分类与功能。 */
export interface SearchIndex {
    /** 分类 id → 分类名的匹配域。 */
    categories: Record<string, SearchField>;
    features: SearchRecord[];
}

/** 一次查询的命中结果。 */
export interface SearchHits {
    /** 分类名命中的分类：该分类下全部功能都要显示。 */
    categories: Set<string>;
    /** 字段命中的功能：显示该功能全部可见设置项。 */
    features: Set<string>;
}

/** 高亮分段：`hit` 为真的一段要包进 `<mark>`。 */
export interface HighlightSegment {
    text: string;
    hit: boolean;
}

/**
 * 同一个字段的多份文案拼成一个匹配域时用的分隔符。
 *
 * 关键词是按空白拆出来的，不可能含有它，所以「跨语言版本拼起来的假命中」不会发生
 * （例如英文版结尾与中文版开头刚好拼出一个词）。
 */
const DOMAIN_SEPARATOR = "\u0000";

/**
 * 解析查询：去掉首尾空白，按空白拆词，统一转小写。
 *
 * 只有空白（或空串）时返回空数组 —— 调用方据此认定「没有在搜」。
 * `\s` 在 JS 里已经覆盖全角空格（U+3000），中文输入法下不会留下拆不开的词。
 */
export const parseQuery = (raw: string): string[] =>
    raw.trim()
        .split(/\s+/)
        .filter((keyword) => keyword !== "")
        .map((keyword) => keyword.toLowerCase());

/**
 * 拼一个字段：丢掉非字符串与空白串，去掉重复的文案。
 *
 * 当前语言的文案与语言文件里的同一条通常一模一样，去重后索引里不留重复。
 */
export const fieldOf = (...variants: (string | undefined | null)[]): SearchField => {
    const seen = new Set<string>();
    const field: string[] = [];
    variants.forEach((variant) => {
        if (typeof variant !== "string") {
            return;
        }
        const text = variant.trim();
        if (text === "" || seen.has(text)) {
            return;
        }
        seen.add(text);
        field.push(text);
    });
    return field;
};

/** 一个字段是否命中：每一个关键词都要出现在它的匹配域里（可以是不同的语言版本）。 */
export const matchField = (field: SearchField, keywords: readonly string[]): boolean => {
    if (field.length === 0 || keywords.length === 0) {
        return false;
    }
    const domain = field.map((text) => text.toLowerCase()).join(DOMAIN_SEPARATOR);
    return keywords.every((keyword) => domain.includes(keyword));
};

/**
 * 按查询算出命中集合。
 *
 * 分类名命中与功能字段命中分开记：前者要显示该分类**全部**功能，后者只显示命中的那个功能
 * （以及它下面的全部可见设置项）。
 */
export const matchIndex = (index: SearchIndex, keywords: readonly string[]): SearchHits => {
    const hits: SearchHits = {categories: new Set(), features: new Set()};
    if (keywords.length === 0) {
        return hits;
    }
    Object.keys(index.categories).forEach((category) => {
        if (matchField(index.categories[category], keywords)) {
            hits.categories.add(category);
        }
    });
    index.features.forEach((record) => {
        if (record.fields.some((field) => matchField(field, keywords))) {
            hits.features.add(record.id);
        }
    });
    return hits;
};

/**
 * 把一段文案切成「命中 / 未命中」的片段，多个关键词的命中范围会合并。
 *
 * 只返回数据，不拼 HTML：调用方按片段新建文本节点与 `<mark>`，用户输入的内容永远不会
 * 当成标签解析。大小写按小写副本定位，切片仍取原文，所以高亮不会改掉文案的样子。
 */
export const highlightSegments = (text: string, keywords: readonly string[]): HighlightSegment[] => {
    const haystack = text.toLowerCase();
    const ranges: {start: number; end: number;}[] = [];
    keywords.forEach((keyword) => {
        if (keyword === "") {
            return;
        }
        let index = haystack.indexOf(keyword);
        while (index >= 0) {
            ranges.push({start: index, end: index + keyword.length});
            index = haystack.indexOf(keyword, index + keyword.length);
        }
    });
    if (ranges.length === 0) {
        return [{text, hit: false}];
    }
    // 相邻 / 重叠的命中合并成一段：`image` 与 `ima` 一起搜时不该切出两层 <mark>
    ranges.sort((left, right) => left.start - right.start);
    const merged: {start: number; end: number;}[] = [];
    ranges.forEach((range) => {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
            return;
        }
        merged.push({...range});
    });
    const segments: HighlightSegment[] = [];
    let cursor = 0;
    merged.forEach((range) => {
        const start = Math.max(0, Math.min(range.start, text.length));
        const end = Math.max(start, Math.min(range.end, text.length));
        if (start > cursor) {
            segments.push({text: text.slice(cursor, start), hit: false});
        }
        if (end > start) {
            segments.push({text: text.slice(start, end), hit: true});
        }
        cursor = Math.max(cursor, end);
    });
    if (cursor < text.length) {
        segments.push({text: text.slice(cursor), hit: false});
    }
    return segments;
};
