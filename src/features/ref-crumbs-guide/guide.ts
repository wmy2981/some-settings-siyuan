/**
 * 「引用面包屑」引导行的实现。
 *
 * 目标插件装没装，决定这一行能做什么：装了就直接开它自己的设置面板，
 * 没装就去集市里它的详情页。判定一律在「用户点的时候」「面板每次打开的时候」现取，
 * 绝不在插件 onload 时缓存结论 —— 各插件的加载是逐条串行的，本插件 onload 时
 * 别的插件可能还没加载完。
 *
 * 开设置面板用的是官方 API（插件实例自己的 openSetting）；跳集市没有对应的官方 API，
 * 只能交给思源的 `siyuan://` 协议，并且只有桌面端和移动端 App 里可靠（纯浏览器端没有集市）。
 */
import {
    getFrontend,
    platformUtils,
    showMessage,
} from "siyuan";
import type {Plugin} from "siyuan";
import type {FeatureActionContext} from "../../core/types";

/** 目标插件的包名，等于它 plugin.json 里的 name。 */
const TARGET = "ref-crumbs-siyuan";
/**
 * 集市详情页地址。
 *
 * 它是思源 `siyuan://` 协议里唯一能定位到某个包的形态：`readme` 表示"在线集市里这个包的
 * 说明页"（包还没装时也有内容，页面上就是「下载」按钮）。
 */
const BAZAAR_URI = `siyuan://bazaar/plugins/${TARGET}/readme`;

/**
 * 取目标插件的实例。
 *
 * 返回 undefined 有两种情况：没装，或者装了但没启用（未启用的插件不在这个列表里）。
 * 两种情况下都开不了它的设置面板，也都该把人引到集市去，所以这里不做区分。
 */
const target = (): Plugin | undefined => window.siyuan.ws?.app?.plugins?.find((plugin) => plugin.name === TARGET);

/**
 * 集市在当前前端是否可用。
 *
 * 移动端可以在「关于」里关掉集市（`system.disabledFeatures` 含 `bazaar`），
 * 关掉之后 `siyuan://bazaar/...` 会被直接拒绝、什么都不发生，所以要提前拦一句。
 */
const bazaarAvailable = (): boolean =>
    getFrontend() !== "mobile" || !window.siyuan.config?.system?.disabledFeatures?.includes("bazaar");

/** 动作行的按钮文案：能开设置面板就说「打开设置」，否则说「去集市安装」。 */
export const refCrumbsActionLabel = (context: FeatureActionContext): string =>
    target() ? context.i18n("refCrumbsGuide.openAction") : context.i18n("refCrumbsGuide.installAction");

export const openRefCrumbs = (context: FeatureActionContext): void => {
    const plugin = target();
    if (plugin) {
        plugin.openSetting();
        return;
    }
    if (!bazaarAvailable()) {
        showMessage(context.i18n("refCrumbsGuide.bazaarUnavailable"), 4000);
        return;
    }
    // 交给思源自己的 open：桌面端走进程内协议处理，移动端交给原生桥
    platformUtils.openByMobile(BAZAAR_URI);
};
