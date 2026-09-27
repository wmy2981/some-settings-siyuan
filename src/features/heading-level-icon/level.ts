/**
 * 引用列表与搜索面板里「标题只显示一个 H」的修正。
 *
 * 内核在这两处给标题块用的是通用图标 `#iconHeadings`（一个纯 H），所以 h1 和 h6
 * 长得一模一样。层级根本没有进 DOM —— 条目上只有块 id 和 `NodeHeading` 这个类型 ——
 * 所以只能拿 id 回内核查一次，然后把结果缓存下来。
 *
 * 拿到层级之后不改 DOM 结构：只把那个 `<use>` 的 href 换成 `#iconH1`..`#iconH6`。
 * 这正是内核自己在反链、大纲面板用的图标，层级数字就画在 H 的右下角（等同下标），
 * 既不需要我们自己排版，也能跟随用户换的图标主题。
 *
 * 查询走 `/api/query/sql` 的批量 `IN`：一次问几十个 id，比一个一个问省得多。
 * 它需要管理员角色，个人工作空间里就是当前会话；拿不到权限或查询失败时
 * 只安静一会儿再试，绝不刷屏，界面退化成本来的纯 H。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 搜索面板、未引用面板与移动端搜索共用的条目。 */
const SEARCH_ITEM_SELECTOR = '[data-type="search-item"]';
/** `((` 引用列表的候选面板。 */
const HINT_CONTAINER_SELECTOR = ".protyle-hint";
const HINT_ITEM_SELECTOR = `${HINT_CONTAINER_SELECTOR} .b3-list-item`;
const ITEM_SELECTOR = `${SEARCH_ITEM_SELECTOR}, ${HINT_ITEM_SELECTOR}`;
/** 这两处给标题块用的通用图标；换成带层级的那几个就是本功能的全部工作。 */
const PLAIN_HEADING_ICON = "#iconHeadings";
/** 我们在条目上留下的标记，值是层级（空串表示查过了、不是标题块）。 */
const MARK_ATTR = "data-ss-heading-level";
/** 一次查询最多带多少个 id。 */
const IDS_PER_QUERY = 50;
/** 查询失败后的冷却时间：失败一次就安静一会儿，不要每帧重试。 */
const RETRY_COOLDOWN_MS = 60_000;
const QUERY_API = "/api/query/sql";
/** 块 id 的字符集，用它挡住拼出畸形 SQL 的可能。 */
const ID_PATTERN = /^[\w-]+$/;
const HEADING_SUBTYPE = /^h([1-6])$/;

interface QueryRow {
    id?: string;
    subtype?: string;
}

interface QueryPayload {
    code?: number;
    msg?: string;
    data?: QueryRow[];
}

export const mountHeadingLevelIcon = (host: FeatureHost): FeatureInstance => {
    /** 块 id → 层级（"1".."6"），空串表示查过了、不是标题块。 */
    const levels = new Map<string, string>();
    /** 正在查询中的 id，避免同一批被反复发出去。 */
    const querying = new Set<string>();
    let frame = 0;
    let retryAfter = 0;
    let reportedFailure = false;

    /** 条目里那个「纯 H」的 use；已经被我们换过的条目就找不到了，因此天然幂等。 */
    const plainHeadingUseOf = (item: HTMLElement): SVGUseElement | undefined => {
        for (const use of item.querySelectorAll<SVGUseElement>("use")) {
            const href = use.getAttribute("href") ?? use.getAttribute("xlink:href");
            if (href === PLAIN_HEADING_ICON) {
                return use;
            }
        }
        return;
    };

    /**
     * 条目对应的块 id。
     * 搜索结果把 id 写在条目自己身上，`((` 的候选写在里面那一层（条目本身也带 data-id），
     * 两处都取一遍就不用为两个面板各写一套。
     */
    const idOf = (item: HTMLElement): string | undefined => {
        const own = item.getAttribute("data-node-id") ?? item.getAttribute("data-id") ?? "";
        if (ID_PATTERN.test(own)) {
            return own;
        }
        const holder = item.querySelector<HTMLElement>("[data-node-id], [data-id]");
        const nested = holder?.getAttribute("data-node-id") ?? holder?.getAttribute("data-id") ?? "";
        return ID_PATTERN.test(nested) ? nested : undefined;
    };

    /** 层级已知就换图标；返回还需要查询的块 id。 */
    const apply = (): string[] => {
        const unknown: string[] = [];
        document.querySelectorAll<HTMLElement>(ITEM_SELECTOR).forEach((item) => {
            if (item.hasAttribute(MARK_ATTR)) {
                return;
            }
            const use = plainHeadingUseOf(item);
            if (!use) {
                return;
            }
            const id = idOf(item);
            if (!id) {
                return;
            }
            const level = levels.get(id);
            if (level === undefined) {
                unknown.push(id);
                return;
            }
            item.setAttribute(MARK_ATTR, level);
            if (level) {
                use.setAttribute("href", `#iconH${level}`);
                use.setAttribute("xlink:href", `#iconH${level}`);
            }
        });
        return unknown;
    };

    /** 批量问一次内核，把结果（含「查无此块」）全部落缓存。 */
    const query = async (ids: string[]): Promise<void> => {
        const literal = ids.map((id) => `'${id}'`).join(",");
        const response = await fetch(QUERY_API, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({stmt: `SELECT id, subtype FROM blocks WHERE id IN (${literal})`}),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json() as QueryPayload;
        if (payload.code !== 0) {
            throw new Error(payload.msg || `code ${payload.code}`);
        }
        const found = new Set<string>();
        (payload.data ?? []).forEach((row) => {
            const id = row.id ?? "";
            if (!ID_PATTERN.test(id)) {
                return;
            }
            found.add(id);
            const matched = HEADING_SUBTYPE.exec(row.subtype ?? "");
            levels.set(id, matched ? matched[1] : "");
        });
        // 内核没返回的 id 也要落缓存：这些块多半不在当前工作空间里（加密笔记本、
        // 刚被删掉），不记下来的话每次扫描都会把它们重新问一遍。
        ids.filter((id) => !found.has(id)).forEach((id) => levels.set(id, ""));
    };

    const requestLevels = (ids: string[]): void => {
        const fresh = [...new Set(ids)].filter((id) => !querying.has(id)).slice(0, IDS_PER_QUERY);
        if (fresh.length === 0) {
            return;
        }
        fresh.forEach((id) => querying.add(id));
        query(fresh).then(() => {
            schedule();
        }).catch((error: unknown) => {
            retryAfter = Date.now() + RETRY_COOLDOWN_MS;
            if (!reportedFailure) {
                reportedFailure = true;
                host.log("查询块类型失败，界面先保持原来的纯 H 图标", error);
            }
        }).finally(() => {
            fresh.forEach((id) => querying.delete(id));
        });
    };

    const scan = () => {
        // 查询失败只是「问不到新层级」，已经缓存下来的层级照旧要应用上去，
        // 所以冷却只挡查询，不挡整个扫描。
        const unknown = apply();
        if (unknown.length > 0 && Date.now() >= retryAfter) {
            requestLevels(unknown);
        }
    };

    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            scan();
        });
    };

    /**
     * 只有「新增的子树里可能带着我们的条目」时才值得扫一遍。
     *
     * 全量观察 `document.body` 是必须的（搜索页签、搜索对话框与每个编辑器的提示面板
     * 都是随时出现的），但整个文档的 querySelectorAll 不能跟着每一次正文输入跑。
     * 这里只看新增节点自己，代价与新增的那一小块子树成正比。
     */
    const worthScanning = (records: MutationRecord[]): boolean => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }
                if (
                    node.matches(ITEM_SELECTOR) || node.matches(HINT_CONTAINER_SELECTOR) ||
                    Boolean(node.querySelector(ITEM_SELECTOR))
                ) {
                    return true;
                }
            }
        }
        return false;
    };

    const observer = new MutationObserver((records) => {
        if (worthScanning(records)) {
            schedule();
        }
    });
    observer.observe(document.body, {childList: true, subtree: true});
    scan();

    return {
        destroy: () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            // 把图标还给内核：条目换成纯 H，标记一并清掉
            document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`).forEach((item) => {
                const level = item.getAttribute(MARK_ATTR) ?? "";
                item.removeAttribute(MARK_ATTR);
                if (!level) {
                    return;
                }
                const use = item.querySelector<SVGUseElement>("use");
                use?.setAttribute("href", PLAIN_HEADING_ICON);
                use?.setAttribute("xlink:href", PLAIN_HEADING_ICON);
            });
        },
    };
};
