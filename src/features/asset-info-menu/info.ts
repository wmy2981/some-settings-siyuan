/**
 * 资源文件元数据菜单的实现。
 *
 * 思源把「扩展右键菜单」这件事收敛成插件事件：图片的右键/长按走 `open-menu-image`，
 * 音频 / 视频 / iframe 这类资源块的块标菜单走 `click-blockicon`。两者给的 `menu` 都是
 * 一个空的 `subMenu`，插件往里加项后，内核会把它挂成菜单里的「插件」子菜单 ——
 * 这是官方唯一允许的挂载位置，所以信息行就在那里，而不是直接铺进原生菜单。
 *
 * 菜单项必须**同步**加进去（事件是同一次同步调用里发完的），所以行先带着占位文字建好，
 * 大小与修改时间等内核返回后再由我们自己写进那一行；拿不到就整行收起来，
 * 不留下空行或"读取中"这种残迹。
 *
 * 只处理工作区自己的资源（`assets/` 开头）：外链图片、`data:` URI 没有"文件大小"
 * 与"修改时间"可言，硬凑一行只会误导人。
 */
import {fetchPost} from "siyuan";
import type {subMenu} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {escapeHtml} from "../../core/ui";

/** 工作区资源的路径前缀。 */
const ASSET_PREFIX = "assets/";
/** 块菜单里值得补信息的资源块类型；图片走它自己的图片菜单。 */
const ASSET_BLOCK_TYPES = new Set(["NodeAudio", "NodeVideo", "NodeIFrame"]);
/** 资源块里承载 `src` 的元素。 */
const MEDIA_SELECTOR = "video[src], audio[src], iframe[src]";

interface Row {
    /** i18n key，写文案时才解析，跟着界面语言走。 */
    key: string;
    /** 结果到手后才知道的值；没有值就整行收起来。 */
    value?: string;
    /** 是否已经有结论。没有结论时显示「读取中」而不是空。 */
    settled: boolean;
    element?: HTMLElement;
}

const isWorkspaceAsset = (src: string): boolean => src.startsWith(ASSET_PREFIX);

const labelOf = (host: FeatureHost, key: string, value?: string): string =>
    `${escapeHtml(host.i18n(key))}: ${escapeHtml(value ?? host.i18n("assetInfo.loading"))}`;

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

const imageOf = (element: HTMLElement | undefined): HTMLImageElement | undefined => {
    if (!element) {
        return undefined;
    }
    if (element instanceof HTMLImageElement) {
        return element;
    }
    return element.querySelector<HTMLImageElement>("img") ?? undefined;
};

/** 图片的真实地址：`data-src` 与 `src` 同值，前者在加密笔记本里还带着 `?box=`。 */
const sourceOf = (image: HTMLImageElement): string => image.getAttribute("data-src") ?? image.getAttribute("src") ?? "";

const appendRows = (host: FeatureHost, menu: subMenu, src: string, image?: HTMLImageElement): void => {
    const rows: Row[] = [];

    const add = (key: string, value?: string): Row => {
        const row: Row = {key, value, settled: typeof value === "string"};
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: labelOf(host, key, value),
            bind: (element: HTMLElement) => {
                // 子菜单展开时才会有元素；那时的值可能已经取回来了
                row.element = element;
                paint(host, row);
            },
        });
        rows.push(row);
        return row;
    };

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
        const image = imageOf(event.detail?.element);
        if (!image) {
            return;
        }
        const src = sourceOf(image);
        if (!isWorkspaceAsset(src)) {
            return;
        }
        appendRows(host, event.detail.menu, src, image);
    });

    host.addEventBus("click-blockicon", (event) => {
        const blockElement = event.detail?.blockElements?.[0];
        if (!blockElement || !ASSET_BLOCK_TYPES.has(blockElement.getAttribute("data-type") ?? "")) {
            return;
        }
        const src = blockElement.querySelector<HTMLElement>(MEDIA_SELECTOR)?.getAttribute("src") ?? "";
        if (!isWorkspaceAsset(src)) {
            return;
        }
        appendRows(host, event.detail.menu, src);
    });

    return {};
};
