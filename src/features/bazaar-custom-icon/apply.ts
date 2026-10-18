/**
 * 把自定义图标贴回集市「已下载」列表。
 *
 * 集市列表是内核自己整块重绘的：切换分类、排序、过滤、检查更新都会重写
 * `#configBazaarDownloaded` 的 innerHTML，所以这里不缓存任何卡片节点，只跟着 DOM 变化
 * 重新对一遍账；已经贴过、图标文件也没变的卡片直接跳过。
 *
 * 图标文件不在工作区 `assets/` 里，内核没有能直接引用的 URL，所以读成 data URL 再交给
 * `<img src>`；同一张图标只读一次，窗口重绘复用。
 *
 * 数据侧只有「文件名 = 作者__包名.扩展名」这一份事实（见 icons.ts），
 * 因此这里按包名匹配卡片即可；作者只在写文件与判断同名包时用得到。
 */
import {reportError} from "../../core/error";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {
    ICON_CHANGED_EVENT,
    listIcons,
    readIconDataUrl,
    type IconFile,
} from "./icons";

/** 集市「已下载」列表的内容容器（更新列表也渲染在这里）。 */
const PANEL_SELECTOR = "#configBazaarDownloaded";
/** 一张集市包卡片；`data-name` 是包名。 */
const CARD_SELECTOR = ".b3-card[data-name]";
/** 卡片左侧的图标槽。 */
const HOLDER_SELECTOR = ".b3-card__img";

export const mountBazaarCustomIcon = (host: FeatureHost): FeatureInstance => {
    const pluginName = host.plugin.name;
    /** 包名 → 图标文件。同名包只可能来自不同作者，按目录顺序取最后一张。 */
    let icons = new Map<string, IconFile>();
    /** 图标文件名 → data URL。图标列表变化时整体丢弃。 */
    const dataUrls = new Map<string, Promise<string>>();

    let content: HTMLElement | null = null;
    let contentObserver: MutationObserver | undefined;
    let frame = 0;
    let applying = false;
    let again = false;
    let disposed = false;
    /**
     * 图标列表的版本号。同一张图被换成同名文件时文件名不变，只有版本号会变；
     * 卡片上的标记带着版本号，换图后才会重新贴一次。
     */
    let revision = 0;

    const refreshList = async (): Promise<void> => {
        try {
            const list = await listIcons(pluginName);
            if (disposed) {
                return;
            }
            revision++;
            icons = new Map();
            list.forEach((icon) => icons.set(icon.name, icon));
            dataUrls.clear();
            schedule();
        } catch (error) {
            // 读不到目录时保留上一次的图标，不把已经贴好的东西撤掉
            reportError("bazaar-custom-icon.list", error, false);
        }
    };

    const dataUrlOf = (icon: IconFile): Promise<string> => {
        const cached = dataUrls.get(icon.fileName);
        if (cached) {
            return cached;
        }
        const promise = readIconDataUrl(icon).catch((error: unknown) => {
            // 下次再试；一张坏图不该让其他图标也不再加载
            dataUrls.delete(icon.fileName);
            throw error;
        });
        dataUrls.set(icon.fileName, promise);
        return promise;
    };

    const restore = (holder: HTMLElement): void => {
        const original = holder.querySelector<HTMLImageElement>("img[data-ss-original]");
        if (original) {
            original.src = original.dataset.ssOriginal ?? "";
            delete original.dataset.ssOriginal;
        }
        holder.querySelector<HTMLImageElement>("img[data-ss-custom-icon]")?.remove();
        if (holder.dataset.ssHidPlaceholder === "true") {
            holder.querySelector<HTMLElement>("span")?.classList.remove("fn__none");
            delete holder.dataset.ssHidPlaceholder;
        }
        delete holder.dataset.ssIcon;
    };

    const write = (holder: HTMLElement, icon: IconFile, url: string): void => {
        const image = holder.querySelector<HTMLImageElement>("img");
        if (image && image.dataset.ssCustomIcon !== "true") {
            if (image.dataset.ssOriginal === undefined) {
                image.dataset.ssOriginal = image.getAttribute("src") ?? "";
            }
            image.src = url;
        } else if (image) {
            image.src = url;
        } else {
            // 这个包本来没有图标，卡片里只有一个占位 span：补一张图并把它藏起来
            const placeholder = holder.querySelector<HTMLElement>("span");
            if (placeholder) {
                placeholder.classList.add("fn__none");
                holder.dataset.ssHidPlaceholder = "true";
            }
            const custom = document.createElement("img");
            custom.src = url;
            custom.alt = "";
            custom.dataset.ssCustomIcon = "true";
            holder.prepend(custom);
        }
        holder.dataset.ssIcon = `${revision}:${icon.fileName}`;
    };

    const applyCard = async (card: HTMLElement): Promise<void> => {
        const name = card.dataset.name;
        const holder = card.querySelector<HTMLElement>(HOLDER_SELECTOR);
        if (!name || !holder) {
            return;
        }
        const icon = icons.get(name);
        if (!icon) {
            restore(holder);
            return;
        }
        if (holder.dataset.ssIcon === `${revision}:${icon.fileName}`) {
            return;
        }
        let url: string;
        try {
            url = await dataUrlOf(icon);
        } catch (error) {
            reportError("bazaar-custom-icon.read", error, false);
            return;
        }
        // 等图标读完时列表可能已经翻过一版（换图、改目录）：旧结果不许再贴回去
        if (disposed || !holder.isConnected || icons.get(name) !== icon) {
            return;
        }
        write(holder, icon, url);
    };

    const apply = async (): Promise<void> => {
        if (applying) {
            again = true;
            return;
        }
        applying = true;
        try {
            const cards = Array.from(document.querySelectorAll<HTMLElement>(`${PANEL_SELECTOR} ${CARD_SELECTOR}`));
            for (const card of cards) {
                await applyCard(card);
            }
        } finally {
            applying = false;
            if (again) {
                again = false;
                schedule();
            }
        }
    };

    function schedule(): void {
        if (frame || disposed) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            void apply();
        });
    }

    /** 盯住「已下载」容器本身；集市每次重绘都会替换它的子节点。 */
    const syncTarget = (): void => {
        const next = document.querySelector<HTMLElement>(PANEL_SELECTOR);
        if (next === content) {
            return;
        }
        contentObserver?.disconnect();
        content = next;
        if (!content) {
            return;
        }
        contentObserver = new MutationObserver(() => schedule());
        contentObserver.observe(content, {childList: true, subtree: true});
        schedule();
    };

    /**
     * 集市面板是设置弹窗里的一块内容，弹窗与页签切换都发生在 `.b3-dialog` 下；
     * 只对这类节点做一次廉价的查询，避免编辑器里的每一次输入都触发重扫。
     */
    const onBodyMutations = (mutations: MutationRecord[]): void => {
        for (const mutation of mutations) {
            const target = mutation.target;
            if (
                target === document.body ||
                (target instanceof Element && target.closest(".b3-dialog"))
            ) {
                syncTarget();
                return;
            }
        }
    };

    const refresh = (): void => {
        void refreshList();
    };
    document.addEventListener(ICON_CHANGED_EVENT, refresh);

    const bodyObserver = new MutationObserver(onBodyMutations);
    bodyObserver.observe(document.body, {childList: true, subtree: true});
    syncTarget();
    void refreshList();

    return {
        destroy: () => {
            disposed = true;
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            document.removeEventListener(ICON_CHANGED_EVENT, refresh);
            bodyObserver.disconnect();
            contentObserver?.disconnect();
            document.querySelectorAll<HTMLElement>(`${PANEL_SELECTOR} ${HOLDER_SELECTOR}[data-ss-icon]`)
                .forEach((holder) => restore(holder));
        },
    };
};
