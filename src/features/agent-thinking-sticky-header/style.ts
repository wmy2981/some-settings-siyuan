/**
 * 智能体思考标题固定的实现：一段 CSS。
 *
 * 选择器直接用思源自带的类名，不额外加限定层级：这套类名只出现在智能体聊天的思考卡片上，
 * 多套一层（例如要求它是停靠面板的子节点）反而会在编辑器内的 AI 面板里失效。
 * 也不使用 `!important`：思源自己没有给这个标题写过 `position`，没有需要压过的声明。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const CSS = `/* 智能体思考卡片的标题固定在面板顶部 */
.agent-chat__thinking-header {
    position: sticky;
    top: 0;
    z-index: 2;
    background-color: var(--b3-theme-background);
}
`;

export const mountAgentThinkingStickyHeader = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    return {};
};
