/**
 * 功能：按作者屏蔽在线集市列表里的包。
 *
 * 屏蔽对象只有「在线列表」（插件 / 主题 / 图标 / 模板 / 组件五个页签里从集市拉回来的那些卡片），
 * 已下载与可更新列表不动。作者取卡片上的 `.b3-card__author`，内容就是集市索引的 author 字段；
 * 匹配规则见 `authors.ts`（完全匹配、忽略大小写）。
 *
 * 动态更新靠两层：
 * 1. 观察每个列表容器：宿主切换排序 / 筛选、虚拟化补卡都会重写 `#configBazaarX` 的内容，
 *    观察者在同一个任务里（微任务、绘制之前）把新卡片重新对一遍账，所以不会闪出被屏蔽的卡；
 * 2. 设置面板改名单时立刻重算，不用等下一次列表重绘。
 *
 * 计数修正与「全部被屏蔽」提示需要知道整份列表的数据，而列表是虚拟化的、DOM 里数不全，
 * 所以另挂一个响应观察者读宿主实际拿到的包数组（见 `list.ts`）；宿主自己重绘后计数器与
 * 我们算出来的条数对不上时（关键字刚换、响应还没到），一律不动计数器，等新响应到了再修正。
 *
 * 屏蔽用 CSS 收掉整张卡片（`display: none`），不删除节点：宿主的分批渲染状态引用着这些节点，
 * 删掉会让它后续的补卡逻辑错位。全部被屏蔽时连同卡片网格一起收起，只留一行说明 ——
 * 否则虚拟化留下的空占位卡会显示成一排空盒子。
 */
import {
    fetchSyncPost,
    getFrontend,
} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {
    isAuthorBlocked,
    parseAuthorList,
} from "./authors";
import {
    BAZAAR_TYPES,
    createBazaarListTap,
    LIST_ENDPOINT_BY_TYPE,
    packagesOfResponse,
    PANEL_ID_BY_TYPE,
    visiblePackagesOf,
    type BazaarPackage,
    type BazaarType,
    type CompatibilityFilters,
} from "./list";

/** 被屏蔽卡片的标记属性；CSS 靠它把卡片整张收掉。 */
const BLOCKED_ATTR = "data-ss-bazaar-blocked";
/** 整个列表都被屏蔽时挂在容器上的标记；CSS 靠它收起空占位卡组成的网格。 */
const ALL_BLOCKED_ATTR = "data-ss-bazaar-all-blocked";
/** 全被屏蔽时补在列表下面的提示节点。 */
const HINT_ATTR = "data-ss-bazaar-blocked-hint";
/** 只认在线列表的卡片：已下载 / 可更新列表的卡片带别的 `data-package-source`。 */
const CARD_SELECTOR = ".b3-card[data-package-source='bazaar']";
/** 作者在卡片上的位置，内容就是集市索引的 author 字段。 */
const AUTHOR_SELECTOR = ".b3-card__author";
/** 提示文案的 i18n key 与条数占位符。 */
const HINT_KEY = "feature.bazaarAuthorBlocklist.allBlocked";
const HINT_PLACEHOLDER = "{count}";

const CSS = `
.config-bazaar__content .b3-card[${BLOCKED_ATTR}] {
    display: none !important;
}
.config-bazaar__content[${ALL_BLOCKED_ATTR}] > .b3-cards {
    display: none !important;
}
`;

/** 计数修正的状态：宿主自己算出来的总数，以及我们写上去的修正值。 */
interface CounterState {
    hostCount: number;
    corrected: number;
}

interface HostBazaarConfig {
    compatibilityFilters?: Record<string, CompatibilityFilters>;
}

/** 宿主的兼容性筛选设置；读不到时按「都没勾」处理。 */
const compatibilityFiltersOf = (type: BazaarType): CompatibilityFilters | undefined => {
    const config = (window.siyuan as unknown as {config?: {bazaar?: HostBazaarConfig;};}).config;
    return config?.bazaar?.compatibilityFilters?.[type];
};

/** 宿主的列表接口对插件 / 主题额外带 frontend 参数，其余三种不带。 */
const needsFrontend = (type: BazaarType): boolean => type === "plugins" || type === "themes";

export const mountBazaarAuthorBlocklist = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);

    let authors = parseAuthorList(host.config.authors);
    /** 五种列表的内容容器；宿主没渲染集市页签时一个都没有。 */
    const containers = new Map<BazaarType, HTMLElement>();
    const observers = new Map<BazaarType, MutationObserver>();
    /** 每种列表最近一次拿到的包数组（响应观察者或兜底请求）。 */
    const packages = new Map<BazaarType, readonly BazaarPackage[]>();
    /** 计数修正状态，键是列表类型；容器换了就丢掉重来。 */
    const counters = new Map<BazaarType, CounterState>();
    /** 正在兜底拉取的列表，避免同一类型重复发请求。 */
    const fetching = new Set<BazaarType>();

    let scheduled = false;
    let disposed = false;

    host.log.info(`marketplace author blocklist mounted (${authors.size} author(s))`);

    /**
     * 对账安排在微任务里：MutationObserver 的回调本身就在渲染之前跑，
     * 这里再把同一轮里的多次变动并成一次，确保被屏蔽的卡片在**绘制之前**就被收掉，
     * 切排序 / 筛选时不会闪一帧。
     */
    const schedule = (): void => {
        if (scheduled || disposed) {
            return;
        }
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (!disposed) {
                reconcile();
            }
        });
    };

    /** 把容器里每张在线卡片的作者对一遍账：命中名单就收掉，名单改了再放出来。 */
    const applyCards = (container: HTMLElement): void => {
        container.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => {
            const author = card.querySelector<HTMLElement>(AUTHOR_SELECTOR)?.textContent ?? "";
            if (isAuthorBlocked(author, authors)) {
                card.setAttribute(BLOCKED_ATTR, "true");
            } else {
                card.removeAttribute(BLOCKED_ATTR);
            }
        });
    };

    /**
     * 全被屏蔽时的说明行：宿主自己的空状态只在「一个包都没有」时出现，
     * 这里要补的是「有包、但都被名单收掉了」。节点是插件自己造的，不碰宿主的 DOM 结构；
     * 宿主重绘会把它冲掉，观察者随后重新补上。
     */
    const setHint = (container: HTMLElement, count: number): void => {
        const existing = container.querySelector<HTMLElement>(`[${HINT_ATTR}]`);
        if (count === 0) {
            existing?.remove();
            container.removeAttribute(ALL_BLOCKED_ATTR);
            return;
        }
        let hint = existing;
        if (!hint) {
            hint = document.createElement("ul");
            hint.className = "b3-list b3-list--background";
            hint.setAttribute(HINT_ATTR, "");
            hint.append(document.createElement("li"));
            hint.firstElementChild?.classList.add("b3-list--empty");
            container.append(hint);
        }
        const item = hint.firstElementChild;
        const text = host.i18n(HINT_KEY).replace(HINT_PLACEHOLDER, String(count));
        if (item && item.textContent !== text) {
            item.textContent = text;
        }
        container.setAttribute(ALL_BLOCKED_ATTR, "");
    };

    /**
     * 按「当前列表里有多少个包属于被屏蔽作者」修正计数器，并在全部被屏蔽时补提示。
     *
     * 只有拿到的数据与宿主此刻显示的那份对得上才动计数器：
     * 宿主的计数器显示的是它渲染出来的条数，我们对同一份数据套同样的筛选规则算一遍；
     * 两个数字一致才说明手里的数据就是当前列表，否则（关键字刚换、响应还没回来）保持原样。
     */
    const applyCounter = (container: HTMLElement, type: BazaarType): void => {
        const counter = container.parentElement?.querySelector<HTMLElement>(".counter");
        if (!counter) {
            return;
        }
        const list = packages.get(type);
        if (!list) {
            return;
        }
        const panel = container.closest(".config-bazaar__panel");
        const themeMode = type === "themes" ?
            panel?.querySelector<HTMLSelectElement>("#bazaarSelect")?.value :
            undefined;
        const visible = visiblePackagesOf(list, type, themeMode, compatibilityFiltersOf(type));
        const blocked = visible.reduce((count, item) => count + (isAuthorBlocked(item.author, authors) ? 1 : 0), 0);
        const shown = Number(counter.textContent?.trim() ?? "");
        const previous = counters.get(type);
        const hostCount = shown === visible.length ?
            visible.length :
            previous && shown === previous.corrected ?
            previous.hostCount :
            undefined;
        if (hostCount === undefined) {
            // 手里的数据与宿主此刻显示的那份对不上（例如关键字刚换、新响应还没到）：
            // 计数保持宿主自己的值，提示也先撤掉 —— 数据不可信时不要替宿主下结论。
            setHint(container, 0);
            return;
        }
        const corrected = Math.max(0, hostCount - blocked);
        // 每次重绘都会走这里，只在数字真的变了的时候记一行，避免刷屏
        if (blocked > 0 && (!previous || previous.hostCount !== hostCount || previous.corrected !== corrected)) {
            host.log.info(`hid ${blocked} of ${hostCount} ${type} packages`);
        }
        counters.set(type, {hostCount, corrected});
        const text = String(corrected);
        if (counter.textContent !== text) {
            counter.textContent = text;
        }
        setHint(container, blocked > 0 && blocked === visible.length ? blocked : 0);
    };

    const reconcile = (): void => {
        BAZAAR_TYPES.forEach((type) => {
            const container = containers.get(type);
            if (!container || !container.isConnected) {
                return;
            }
            applyCards(container);
            applyCounter(container, type);
        });
    };

    /**
     * 功能在列表已经渲染完之后才启用时，响应观察者没赶上那次请求：这里按面板当前的
     * 关键字补一次同样的请求，只为了拿到计数要用的数据；之后的重绘仍由观察者接管。
     */
    const fetchPackages = async (type: BazaarType, container: HTMLElement): Promise<void> => {
        if (fetching.has(type)) {
            return;
        }
        fetching.add(type);
        const panel = container.closest(".config-bazaar__panel");
        const keyword = panel?.querySelector<HTMLInputElement>(".b3-text-field")?.value.trim() ?? "";
        const request: Record<string, unknown> = {keyword};
        if (needsFrontend(type)) {
            request.frontend = getFrontend();
        }
        try {
            const response = await fetchSyncPost(LIST_ENDPOINT_BY_TYPE[type], request) as unknown;
            if (disposed || packages.has(type)) {
                return;
            }
            const list = packagesOfResponse(response);
            if (list) {
                packages.set(type, list);
                host.log.info(`loaded ${list.length} ${type} packages for the blocklist`);
                schedule();
            }
        } catch (error) {
            host.log.warn(`could not fetch the ${type} marketplace list for the blocklist`, error);
        } finally {
            fetching.delete(type);
        }
    };

    const refreshMissingPackages = (): void => {
        // 名单是空的就什么都不用算：没有要屏蔽的作者，计数保持宿主自己的值
        if (authors.size === 0) {
            return;
        }
        BAZAAR_TYPES.forEach((type) => {
            const container = containers.get(type);
            if (!container || packages.has(type) || !container.querySelector(".b3-cards")) {
                return;
            }
            void fetchPackages(type, container);
        });
    };

    /** 找出当前文档里的在线列表容器，换成新的就重新挂观察者。 */
    const syncContainers = (): void => {
        let changed = false;
        BAZAAR_TYPES.forEach((type) => {
            const next = document.getElementById(PANEL_ID_BY_TYPE[type]);
            const current = containers.get(type);
            if (next === current) {
                return;
            }
            observers.get(type)?.disconnect();
            observers.delete(type);
            counters.delete(type);
            changed = true;
            if (!next) {
                containers.delete(type);
                return;
            }
            const observer = new MutationObserver(() => schedule());
            observer.observe(next, {childList: true, subtree: true});
            observers.set(type, observer);
            containers.set(type, next);
            host.log.info(`tracking the ${type} marketplace list`);
        });
        if (changed) {
            refreshMissingPackages();
            schedule();
        }
    };

    const removeTap = createBazaarListTap(
        (type, list) => {
            packages.set(type, list);
            host.log.info(`read ${list.length} ${type} packages from a list response`);
            schedule();
        },
        (message, error) => host.log.warn(message, error),
    );

    // 集市页签（桌面端在设置弹窗里，移动端在 #model 里）出现、关闭、被整块替换时，
    // 容器本身也跟着换；只对这两处下的变动做一次廉价的容器对账，编辑器里的输入不触发重扫。
    const bodyObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const target = mutation.target;
            if (
                target === document.body ||
                (target instanceof Element && target.closest(".b3-dialog, #model"))
            ) {
                syncContainers();
                return;
            }
        }
    });
    bodyObserver.observe(document.body, {childList: true, subtree: true});
    syncContainers();

    host.onConfigChange(() => {
        authors = parseAuthorList(host.config.authors);
        host.log.info(`author blocklist updated (${authors.size} author(s))`);
        refreshMissingPackages();
        schedule();
    });

    return {
        destroy: () => {
            disposed = true;
            bodyObserver.disconnect();
            observers.forEach((observer) => observer.disconnect());
            removeTap();
            // 计数先交还宿主：把改过的数字改回宿主自己的总数，再清提示与卡片标记
            counters.forEach((state, type) => {
                const counter = containers.get(type)?.parentElement?.querySelector<HTMLElement>(".counter");
                if (counter && counter.textContent === String(state.corrected)) {
                    counter.textContent = String(state.hostCount);
                }
            });
            document.querySelectorAll<HTMLElement>(`[${BLOCKED_ATTR}]`)
                .forEach((card) => card.removeAttribute(BLOCKED_ATTR));
            document.querySelectorAll<HTMLElement>(`[${HINT_ATTR}]`).forEach((hint) => hint.remove());
            document.querySelectorAll<HTMLElement>(`[${ALL_BLOCKED_ATTR}]`)
                .forEach((container) => container.removeAttribute(ALL_BLOCKED_ATTR));
            host.log.info("marketplace author blocklist unmounted");
        },
    };
};
