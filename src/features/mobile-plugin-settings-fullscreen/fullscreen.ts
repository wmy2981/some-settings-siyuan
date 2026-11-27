/**
 * 让插件设置抽屉在移动端一打开就铺满可用高度。
 *
 * 宿主把抽屉高度按「半屏」写进**内联** `height` / `max-height`，并且会在内容变化、
 * 键盘起落、旋转时反复重算，所以直接改内联值要一直跟宿主抢；这里改用一条带
 * `!important` 的样式压过内联值，百分比高度相对的是宿主已经摆好的抽屉外层
 * （`.mobile-sheet-layout`，安全区、键盘与可视视口都由它算），
 * 软键盘弹起、旋转后抽屉仍然自动跟着铺满，不需要在插件里量尺寸。
 *
 * 内联值一个字节都不动：同一批抽屉也被「移动端抽屉高度按内容自适应」盯着，双方都写内联值
 * 会互相触发观察器、来回抢。
 *
 * 哪些抽屉算插件设置：宿主把插件设置交给 `Setting` 打开，标题就是插件的显示名
 * （自定义设置面板通常用插件名），所以拿标题跟本机已装插件列表比对即可 ——
 * 纯被动判断，不接管、不修改任何插件的运行时。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 宿主的抽屉面板类，由 `bindMobileSheetLayout()` 加上。 */
const SHEET_SELECTOR = ".mobile-sheet-panel";
/** 面板标题的类名；标题文字就是 `Setting.open()` 传进来的插件名。 */
const HEADER_CLASS = "b3-dialog__header";
/** 标记类：只有带它的抽屉才铺满。 */
const FULLSCREEN_CLASS = "ss-plugin-settings-fullscreen";
/** 抽屉类名偶尔比插入晚一步才加上，兜底重扫。 */
const RESCAN_INTERVAL_MS = 2000;

interface HostPlugin {
    name?: string;
    displayName?: string;
}

/** 高度交给宿主的抽屉外层：100% 就是它的可用高度（已扣掉安全区）。 */
const CSS = `/* 移动端插件设置抽屉默认全屏 */
.mobile-bottom-sheet-dialog .b3-dialog__container.${FULLSCREEN_CLASS} {
    height: 100% !important;
    max-height: 100% !important;
}
`;

/** 本机已装的插件；宿主没给出列表时返回空数组。 */
const installedPlugins = (): HostPlugin[] => {
    const plugins = (window.siyuan as unknown as {ws?: {app?: {plugins?: unknown;};};})?.ws?.app?.plugins;
    return Array.isArray(plugins) ? plugins as HostPlugin[] : [];
};

/** 插件设置抽屉可能用的标题：宿主默认用显示名，自定义面板通常用插件名。 */
const installedTitles = (): Set<string> => {
    const titles = new Set<string>();
    installedPlugins().forEach((plugin) => {
        [plugin?.displayName, plugin?.name].forEach((title) => {
            const value = typeof title === "string" ? title.trim() : "";
            if (value) {
                titles.add(value);
            }
        });
    });
    return titles;
};

/** 抽屉标题文字；没有标题节点时返回空串。 */
const titleOf = (sheet: HTMLElement): string => {
    const header = Array.from(sheet.children).find((child) => child.classList.contains(HEADER_CLASS));
    return header?.textContent?.trim() ?? "";
};

export const mountMobilePluginSettingsFullscreen = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    const marked = new Set<HTMLElement>();

    const mark = (sheet: HTMLElement, titles: Set<string>) => {
        if (!sheet.isConnected || sheet.classList.contains(FULLSCREEN_CLASS)) {
            return;
        }
        const title = titleOf(sheet);
        if (!title || !titles.has(title)) {
            return;
        }
        sheet.classList.add(FULLSCREEN_CLASS);
        marked.add(sheet);
        host.log.info(`"${title}" opens its settings drawer full screen now`);
    };

    const scan = () => {
        const titles = installedTitles();
        document.querySelectorAll<HTMLElement>(SHEET_SELECTOR)
            .forEach((sheet) => mark(sheet, titles));
        // 关掉的抽屉连同标记一起消失了，不必在这里摘类，只把引用放掉
        marked.forEach((sheet) => {
            if (!sheet.isConnected) {
                marked.delete(sheet);
            }
        });
    };

    const discover = new MutationObserver((records) => {
        const titles = installedTitles();
        records.forEach((record) => {
            record.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) {
                    return;
                }
                if (node.matches(SHEET_SELECTOR)) {
                    mark(node, titles);
                    return;
                }
                node.querySelectorAll<HTMLElement>(SHEET_SELECTOR)
                    .forEach((sheet) => mark(sheet, titles));
            });
        });
    });

    scan();
    if (installedPlugins().length === 0) {
        host.log.warn("the host lists no installed plugin, so no settings drawer will be recognized");
    }
    // 宿主的 `Dialog` 把对话框元素直接挂在 body 下，抽屉类名在同一个任务里就加好了，
    // 所以只看 body 的直接子节点即可；不观察整棵子树，免得编辑器每次重绘都白跑一遍。
    discover.observe(document.body, {childList: true});
    const timer = window.setInterval(scan, RESCAN_INTERVAL_MS);
    host.log.info("mounted: plugin settings drawers open full screen on mobile");

    return {
        destroy: () => {
            window.clearInterval(timer);
            discover.disconnect();
            const released = marked.size;
            marked.forEach((sheet) => sheet.classList.remove(FULLSCREEN_CLASS));
            marked.clear();
            host.log.info(`unmounted: released ${released} settings drawer(s)`);
        },
    };
};
