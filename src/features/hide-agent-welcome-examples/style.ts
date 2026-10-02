/**
 * 隐藏智能体新会话示例推荐的实现：一段 CSS。
 *
 * 推荐项是欢迎页里的普通 `div`，点击监听器由内核绑在元素自己身上，所以让它们不参与渲染
 * 就等于既看不到也点不到，不需要动 DOM，也不需要拦截事件。
 *
 * 选择器补一级父元素提高优先级，避免和面板自己的 flex 规则打架；不使用 `!important`。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const CSS = `/* 隐藏智能体新会话里的示例推荐 */
.agent-welcome > .agent-welcome__examples {
    display: none;
}
`;

export const mountHideAgentWelcomeExamples = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    return {};
};
