/**
 * 资源文件元数据菜单的实现。
 *
 * 思源把「扩展右键菜单」这件事收敛成插件事件，指向一个工作区资源的地方有三处：
 * - 图片自己的右键 / 长按菜单：`open-menu-image`
 * - 指向资源的行内链接：`open-menu-link`（点击或右键那个链接时弹出的菜单）
 * - 块标菜单：`click-blockicon`，资源块（音频 / 视频 / iframe）与引用了资源的块都在这里
 *
 * 事件给的 `detail.menu` 是一个空的 `subMenu`：内核会把插件往里加的东西整体收进菜单末尾的
 * 「插件」子菜单。这几行是资源自己的信息，与插件无关，塞进子菜单等于让用户每次多点一层，
 * 所以这里不用它，直接把菜单项加到**当前正在构建的那个菜单**上
 * （`window.siyuan.menus.menu`：三个事件的调用点都在用它拼菜单，拼完才弹出来）。
 *
 * 菜单项必须**同步**加进去（事件是同一次同步调用里发完的），所以行先带着占位文字建好，
 * 大小与修改时间等内核返回后再由我们自己写进那一行；拿不到就整行收起来，
 * 不留下空行或"读取中"这种残迹。
 *
 * 只处理工作区自己的资源（`assets/` 开头）：外链图片、`data:` URI 没有"文件大小"
 * 与"修改时间"可言，硬凑一行只会误导人。
 */
import {fetchPost} from "siyuan";
import type {
    IMenu,
    Menu,
} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {escapeHtml} from "../../core/ui";

/** 工作区资源的路径前缀。 */
const ASSET_PREFIX = "assets/";
/** 承载资源地址的元素：图片（加密笔记本里地址在 `data-src` 上）、音视频、iframe、行内链接。 */
const IMAGE_SELECTOR = "img";
const MEDIA_SELECTOR = "video[src], audio[src], iframe[src]";
const LINK_SELECTOR = "[data-type='a'][data-href]";
/** 这几行与菜单里原有内容之间的分隔线。 */
const SEPARATOR_ID = "ssAssetInfoSeparator";

interface Row {
    /** i18n key，写文案时才解析，跟着界面语言走。 */
    key: string;
    /** 结果到手后才知道的值；没有值就整行收起来。 */
    value?: string;
    /** 是否已经有结论。没有结论时显示「读取中」而不是空。 */
    settled: boolean;
    element?: HTMLElement;
}

/** 元素自己或它的后代里，第一个引用的工作区资源。 */
interface AssetSource {
    src: string;
    /** 图片元素，能直接量出尺寸时给出。 */
    image?: HTMLImageElement;
}

const isWorkspaceAsset = (src: string): boolean => src.startsWith(ASSET_PREFIX);

const labelOf = (host: FeatureHost, key: string, value?: string): string =>
    `${escapeHtml(host.i18n(key))}: ${escapeHtml(value ?? host.i18n("assetInfo.loading"))}`;

/** 当前正在构建的那个菜单；不在菜单构建过程中时返回 undefined。 */
const currentMenu = (): Menu | undefined => window.siyuan?.menus?.menu;

const paint = (host: FeatureHost, row: Row): void => {
    if (!row.element) {
        return;
    }
    if (typeof row.value === "string") {
        const label = row.element.querySelector<HTMLElement>(".b3-menu__label");
        if (label) {
            label.innerHTML = labelOf(host, row.key, row.value);
        }
        return;
    }
    if (row.settled) {
        // 这项信息拿不到：把整行收起来，而不是留一句"读取中"
        row.element.classList.add("fn__none");
    }
};

/** 取文件扩展名当类型，够用且不需要再发一次请求。 */
const extensionOf = (src: string): string | undefined => {
    const path = src.split("?")[0];
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1) : "";
    return extension ? extension.toUpperCase() : undefined;
};

/** 元素自己或后代里第一个命中选择器的元素。 */
const firstMatch = (element: Element, selector: string): HTMLElement | undefined => {
    const found = element.matches(selector) ? element : element.querySelector(selector);
    return found instanceof HTMLElement ? found : undefined;
};

/** 图片的真实地址：`data-src` 与 `src` 同值，前者在加密笔记本里还带着 `?box=`。 */
const sourceOf = (image: Element): string => image.getAttribute("data-src") ?? image.getAttribute("src") ?? "";

/** 元素自己或后代里第一个工作区资源；没有就返回 undefined。 */
const assetIn = (element: Element | undefined): AssetSource | undefined => {
    if (!element) {
        return undefined;
    }
    const image = firstMatch(element, IMAGE_SELECTOR);
    if (image instanceof HTMLImageElement) {
        const src = sourceOf(image);
        if (isWorkspaceAsset(src)) {
            return {src, image};
        }
    }
    for (const selector of [MEDIA_SELECTOR, LINK_SELECTOR]) {
        const holder = firstMatch(element, selector);
        if (!holder) {
            continue;
        }
        const src = holder.getAttribute(holder.matches(LINK_SELECTOR) ? "data-href" : "src") ?? "";
        if (isWorkspaceAsset(src)) {
            return {src};
        }
    }
    return undefined;
};

const appendRows = (host: FeatureHost, source: AssetSource): void => {
    const menu = currentMenu();
    if (!menu) {
        return;
    }
    const rows: Row[] = [];
    const {src, image} = source;

    const add = (key: string, value?: string): Row => {
        const row: Row = {key, value, settled: typeof value === "string"};
        const item: IMenu = {
            iconHTML: "",
            type: "readonly",
            label: labelOf(host, key, value),
            bind: (element: HTMLElement) => {
                // 行一建好元素就在手上了，值可能晚一点才回来
                row.element = element;
                paint(host, row);
            },
        };
        menu.addItem(item);
        rows.push(row);
        return row;
    };

    menu.addItem({id: SEPARATOR_ID, type: "separator"});
    const size = add("assetInfo.size");
    // 尺寸直接读已经加载好的图片，不必等内核
    if (image && image.naturalWidth > 0) {
        add("assetInfo.dimensions", `${image.naturalWidth} × ${image.naturalHeight}`);
    }
    const type = extensionOf(src);
    if (type) {
        add("assetInfo.type", type);
    }
    const modified = add("assetInfo.modified");

    const settle = (sizeText?: string, modifiedText?: string) => {
        size.value = sizeText;
        size.settled = true;
        modified.value = modifiedText;
        modified.settled = true;
        rows.forEach((row) => paint(host, row));
    };

    void fetchPost(
        "/api/asset/statAsset",
        {path: src},
        (response) => {
            const data = response.code === 0 ? response.data : null;
            settle(data?.hSize, data?.hUpdated);
        },
        undefined,
        () => {
            settle();
        },
    ).catch(() => {
        settle();
    });
};

export const mountAssetInfoMenu = (host: FeatureHost): FeatureInstance => {
    host.addEventBus("open-menu-image", (event) => {
        const source = assetIn(event.detail?.element);
        if (source) {
            appendRows(host, source);
        }
    });

    host.addEventBus("open-menu-link", (event) => {
        const source = assetIn(event.detail?.element);
        if (source) {
            appendRows(host, source);
        }
    });

    host.addEventBus("click-blockicon", (event) => {
        const source = assetIn(event.detail?.blockElements?.[0]);
        if (source) {
            appendRows(host, source);
        }
    });

    return {};
};
