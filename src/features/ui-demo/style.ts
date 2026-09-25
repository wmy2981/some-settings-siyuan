/**
 * 示例功能的实现（分类：界面）。
 *
 * 全程只用 CSS：按当前配置生成一段样式表，通过 <html> 上的一个 data-* 属性生效。
 * 只影响「当前选中的文档树条目」，不触碰任何核心 DOM 结构。
 * 配置一变就重建样式内容，关停则移除属性 + 清空样式表，完全可回退。
 *
 * 不注册任何按钮或面板：界面类功能的正确形态就是「设置项 + 一段 CSS」。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const MARKER = "ss-ui-demo";
const DEFAULT_ACCENT = "red";
const ACCENTS: Record<string, string> = {
    red: "var(--b3-theme-error, #d23f31)",
    orange: "#e69500",
    green: "#4cae4c",
    blue: "#3575f0",
};

const ACCENT_KEYS = Object.keys(ACCENTS);

const buildCss = (accent: string): string => {
    const color = ACCENTS[accent] || ACCENTS[DEFAULT_ACCENT];
    return `
html[data-${MARKER}] .sy__file .b3-list--background .b3-list-item--focus {
    border-left: 3px solid ${color};
    border-radius: 0 var(--b3-border-radius) var(--b3-border-radius) 0;
}
`;
};

export const mountUiDemo = (host: FeatureHost): FeatureInstance => {
    const enabledOf = (): boolean => host.config.enabled !== false;
    const accentOf = (): string => {
        const value = String(host.config.accent ?? DEFAULT_ACCENT);
        return ACCENT_KEYS.includes(value) ? value : DEFAULT_ACCENT;
    };

    // 只注册一次：返回的撤销函数负责移除，后续更新复用同一个 <style> 元素
    const removeStyle = host.addStyle(buildCss(accentOf()));

    const apply = () => {
        document.documentElement.toggleAttribute(`data-${MARKER}`, enabledOf());
        host.addStyle(buildCss(accentOf()));
    };

    apply();
    host.onConfigChange(apply);

    return {
        destroy: () => {
            document.documentElement.removeAttribute(`data-${MARKER}`);
            removeStyle();
        },
    };
};
