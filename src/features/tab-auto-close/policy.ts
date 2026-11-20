/**
 * 「自动收起闲置页签」的判定规则。
 *
 * 这一层只回答「哪些页签现在可以收」，不碰 DOM、不碰宿主，运行时的采集与关闭在
 * `tabs.ts`。拆开是因为这里每条规则都值得单独测：误关一个正在用的页签比不关更糟。
 */

/** 采集到的页签快照，桌面端与移动端都归一成这一份形状。 */
export interface IdleTabCandidate {
    /** 宿主里的页签 id（桌面端是 `li.item[data-id]`，移动端是页签模型里的 id）。 */
    id: string;
    /** 页签标题，用于保留关键字匹配。 */
    title: string;
    /** 是不是所在分屏（移动端是页签列表）当前的活动页签。 */
    active: boolean;
    /** 是否钉住。钉住的页签在任何情况下都不收。 */
    pinned: boolean;
    /** 同一分屏里的页签总数；只剩一个时不收，免得把整个分屏关空。 */
    siblings: number;
    /** 最后一次活动的时间戳（毫秒）。0 表示宿主没给，按「不知道」处理，永不收。 */
    lastActive: number;
    /**
     * 宿主是否为这个页签准备了一个面板。
     *
     * 桌面端后台页签的面板是空的（编辑器等切到前台才渲染），所以这里只能看「有没有面板」，
     * 不能看面板里有没有 `.protyle`：后台页签永远没有，按那条判会一个都收不掉。
     */
    closeable: boolean;
}

export interface IdleTabPolicy {
    /** 判定时的时间戳。 */
    now: number;
    /** 闲置阈值（毫秒）。 */
    idleMs: number;
    /** 保留关键字，已小写化；标题命中任意一个就跳过。 */
    keywords: string[];
}

/**
 * 解析保留关键字：逗号（中英文）、顿号、空白都当分隔符，去空、去重、统一小写。
 *
 * 用户在设置里怎么顺手怎么写即可，不必记分隔符规则。
 */
export const parseKeywords = (raw: string): string[] => {
    const seen = new Set<string>();
    raw.split(/[,，、\s]+/).forEach((item) => {
        const keyword = item.trim().toLowerCase();
        if (keyword) {
            seen.add(keyword);
        }
    });
    return [...seen];
};

/** 标题里是否命中保留关键字。 */
export const matchesKeyword = (title: string, keywords: string[]): boolean => {
    if (keywords.length === 0) {
        return false;
    }
    const text = title.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
};

/**
 * 从候选里挑出这一轮该收起的页签，按最后活动时间从旧到新排序。
 *
 * 判定顺序就是「不改主意的理由」的优先级：不是文档 -> 正在用 -> 钉住 -> 分屏里只剩它 ->
 * 时间未知 -> 还没到阈值 -> 命中保留关键字。任何一条成立都不收。
 */
export const pickIdleTabs = (tabs: IdleTabCandidate[], policy: IdleTabPolicy): IdleTabCandidate[] =>
    tabs
        .filter((tab) => {
            if (!tab.closeable) {
                return false;
            }
            if (tab.active || tab.pinned) {
                return false;
            }
            if (tab.siblings < 2) {
                return false;
            }
            if (!tab.lastActive) {
                return false;
            }
            if (policy.now - tab.lastActive < policy.idleMs) {
                return false;
            }
            return !matchesKeyword(tab.title, policy.keywords);
        })
        .sort((left, right) => left.lastActive - right.lastActive);
