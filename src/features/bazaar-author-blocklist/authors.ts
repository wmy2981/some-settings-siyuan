/**
 * 作者屏蔽名单的解析与匹配。
 *
 * 名单是设置面板里的一段多行文本，一行一个作者。解析时去掉行首尾空白、丢掉空行、
 * 大小写归一后去重 —— 用户在名单里留空行、或同一个作者写了两遍都不该有额外后果。
 *
 * 匹配规则是**完全匹配**：只认集市索引 author 字段的完整值，不做子串、前缀、正则或模糊匹配，
 * 所以屏蔽 `foo` 不会连带屏蔽 `foobar`。大小写不敏感：author 是 GitHub 用户名，
 * GitHub 本身不区分大小写，索引里的大小写写法也不一定稳定。
 */

/** 把一段多行文本解析成作者集合（全部小写、已去空白与空行、已去重）。 */
export const parseAuthorList = (raw: unknown): Set<string> => {
    const authors = new Set<string>();
    if (typeof raw !== "string") {
        return authors;
    }
    raw.split(/\r?\n/).forEach((line) => {
        const author = line.trim().toLowerCase();
        if (author) {
            authors.add(author);
        }
    });
    return authors;
};

/** 这个作者是否在名单里。空值一律不算命中（索引里 author 为空时不该被一条空行屏蔽）。 */
export const isAuthorBlocked = (author: unknown, authors: ReadonlySet<string>): boolean => {
    if (typeof author !== "string" || authors.size === 0) {
        return false;
    }
    const value = author.trim().toLowerCase();
    return value !== "" && authors.has(value);
};
