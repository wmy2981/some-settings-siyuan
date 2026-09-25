/**
 * 示例功能的实现（分类：功能）。
 *
 * 演示一个完整的「功能」类设置项应该怎么做：
 * - 只经由 FeatureHost 使用官方 API（夹带插件 API、事件、内核 API 都由 host 提供入口）
 * - 所有注册都带清理（顶栏按钮、快捷键命令随插件卸载释放，定时器随 signal 取消）
 * - 配置变化即时生效，不需要重新加载插件
 */
import {adaptHotkey} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const ICON_ID = "iconSSFunctionDemo";

/** 内联图标，viewBox 与思源内置图标一致。 */
const ICON = `<symbol id="${ICON_ID}" viewBox="0 0 32 32">
<path d="M25.333 8h-4v-1.333a2.667 2.667 0 0 0-2.666-2.667h-5.334A2.667 2.667 0 0 0 10.667 6.667V8h-4A2.667 2.667 0 0 0 4 10.667v13.333A2.667 2.667 0 0 0 6.667 26.667h18.666A2.667 2.667 0 0 0 28 24v-13.333A2.667 2.667 0 0 0 25.333 8zm-12-1.333h5.334V8h-5.334zm10.667 16H8V10.667h16z"></path>
<path d="M13.333 13.333h5.334v5.334h-5.334z"></path>
</symbol>`;

const enabledOf = (host: FeatureHost): boolean => host.config.enabled !== false;
const textOf = (host: FeatureHost): string => String(host.config.text ?? "Some Settings");
const delayOf = (host: FeatureHost): number => {
    const value = Number(host.config.delay);
    return Number.isFinite(value) && value > 0 ? value : 0;
};

export const mountDemo = (host: FeatureHost): FeatureInstance => {
    host.addIcons(ICON);

    const say = () => {
        const text = textOf(host);
        const delay = delayOf(host);
        if (delay === 0) {
            host.showMessage(text);
            return;
        }
        const timer = window.setTimeout(() => {
            if (!host.signal.aborted) {
                host.showMessage(text);
            }
        }, delay);
        host.signal.addEventListener("abort", () => window.clearTimeout(timer), {once: true});
    };

    host.addTopBar({
        id: "function-demo",
        icon: ICON_ID,
        title: host.i18n("functionDemo.iconTitle"),
        callback: () => {
            if (!enabledOf(host)) {
                host.showMessage(host.i18n("functionDemo.disabledHint"));
                return;
            }
            say();
        },
    });

    host.addCommand({
        langKey: "functionDemoCommand",
        langText: host.i18n("functionDemo.iconTitle"),
        hotkey: "⌥⌘S",
        callback: () => say(),
    });

    host.log(`已挂载；快捷键 ${adaptHotkey("⌥⌘S")}，当前 enabled=${enabledOf(host)} delay=${delayOf(host)}`);

    return {};
};
