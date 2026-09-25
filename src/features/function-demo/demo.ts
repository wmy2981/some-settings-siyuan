/**
 * 示例功能的实现（分类：功能）。
 *
 * 演示一个完整的「功能」类设置项应该怎么做：
 * - 只经由 FeatureHost 使用官方 API
 * - 行为在调用时读取当前配置，所以面板一保存就立即生效，不需要重载插件
 * - 定时器随 signal 取消，插件卸载不留残留
 */
import {adaptHotkey} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const enabledOf = (host: FeatureHost): boolean => host.config.enabled !== false;
const textOf = (host: FeatureHost): string => String(host.config.text ?? "Some Settings");
const delayOf = (host: FeatureHost): number => {
    const value = Number(host.config.delay);
    return Number.isFinite(value) && value > 0 ? value : 0;
};

export const mountDemo = (host: FeatureHost): FeatureInstance => {
    const say = () => {
        if (!enabledOf(host)) {
            return;
        }
        const delay = delayOf(host);
        if (delay === 0) {
            host.showMessage(textOf(host));
            return;
        }
        const timer = window.setTimeout(() => {
            if (!host.signal.aborted) {
                host.showMessage(textOf(host));
            }
        }, delay);
        host.signal.addEventListener("abort", () => window.clearTimeout(timer), {once: true});
    };

    host.addCommand({
        langKey: "functionDemoCommand",
        langText: host.i18n("functionDemo.text"),
        hotkey: "⌥⌘S",
        callback: () => say(),
    });

    host.log(`已挂载；快捷键 ${adaptHotkey("⌥⌘S")}，当前 enabled=${enabledOf(host)}`);

    return {};
};
