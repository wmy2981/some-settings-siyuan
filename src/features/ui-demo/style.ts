/**
 * 示例功能的实现（分类：界面）。
 *
 * 全程只用 CSS：按当前配置生成一段样式表，通过 <html> 上的一个 data-* 属性生效。
 * 只影响「当前选中的文档树条目」和插件自己注册的顶栏按钮，不触碰任何核心 DOM 结构。
 * 配置一变就重建样式内容，关停则移除属性 + 清空样式表，完全可回退。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const ICON_ID = "iconSSUiDemo";
const MARKER = "ss-ui-demo";
const DEFAULT_ACCENT = "red";
const ACCENTS: Record<string, string> = {
    red: "var(--b3-theme-error, #d23f31)",
    orange: "#e69500",
    green: "#4cae4c",
    blue: "#4285f4",
};

const ICON = `<symbol id="${ICON_ID}" viewBox="0 0 32 32">
<path d="M16 3.2l3.4 9.2 9.4.4-7.4 6.2 2.4 9.4L16 23l-7.8 5.4 2.4-9.4L3.2 12.8l9.4-.4z"></path>
</symbol>`;

const ACCENT_KEYS = Object.keys(ACCENTS);

const buildCss = (accent: string): string => {
    const color = ACCENTS[accent] || ACCENTS[DEFAULT_ACCENT];
    return `
html[data-${MARKER}] .sy__file .b3-list--background .b3-list-item--focus {
    border-left: 3px solid ${color};
    border-radius: 0 var(--b3-border-radius) var(--b3-border-radius) 0;
}
html[data-${MARKER}] [data-${MARKER}-button] {
    border-bottom: 3px solid ${color};
}
html[data-${MARKER}] [data-${MARKER}-button] svg {
    color: ${color};
}
`;
};

export const mountUiDemo = (host: FeatureHost): FeatureInstance => {
    host.addIcons(ICON);

    const enabledOf = (): boolean => host.config.enabled !== false;
    const accentOf = (): string => {
        const value = String(host.config.accent ?? DEFAULT_ACCENT);
        return ACCENT_KEYS.includes(value) ? value : DEFAULT_ACCENT;
    };

    // 只注册一次：返回的撤销函数负责移除，后续更新复用同一个 <style> 元素
    const removeStyle = host.addStyle(buildCss(accentOf()));

    const button = host.addTopBar({
        id: "ui-demo",
        icon: ICON_ID,
        title: host.i18n("uiDemo.iconTitle"),
        callback: () => {
            host.showMessage(enabledOf() ? host.i18n("uiDemo.active") : host.i18n("uiDemo.disabledHint"));
        },
    });

    const apply = () => {
        const enabled = enabledOf();
        document.documentElement.toggleAttribute(`data-${MARKER}`, enabled);
        button?.toggleAttribute(`data-${MARKER}-button`, enabled);
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
