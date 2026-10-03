/**
 * 智能体思考标题固定的实现：一段 CSS。
 *
 * 选择器直接用思源自带的类名，不额外加限定层级：这套类名只出现在智能体聊天的思考卡片上，
 * 多套一层（例如要求它是停靠面板的子节点）反而会在编辑器内的 AI 面板里失效。
 * 也不使用 `!important`：思源自己没有给这个标题写过 `position`，没有需要压过的声明。
 *
 * 为什么 `top` 是负的：粘性定位的偏移参照的是滚动容器（消息区）的**内容盒**，
 * 而那个容器带 `padding-top`（桌面与移动端都是 12px），于是 `top: 0` 会把标题停在
 * 内边距下沿，面板顶部到标题之间露出一条 12px 的缝、缝里能看到滚过去的内容。
 * 负这么多正好把它顶到容器边缘，量出来贴合（缝隙 0）；负偏移只影响吸顶后的位置，
 * 标题还没滚到顶部时仍停在卡片自己的位置上（都实测过）。
 *
 * 代价是这一个值与思源 `.agent-chat__messages` 的 `padding-top` 绑在一起：思源改了它，
 * 这里要跟着改（改大留一条缝、改小会把标题顶部裁掉一点）。主题若改写了那个内边距同理。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 与思源 `.agent-chat__messages` 的 `padding-top` 一致；见文件头。 */
const MESSAGES_PADDING_TOP = 12;

const CSS = `/* 智能体思考卡片的标题固定在面板顶部 */
.agent-chat__thinking-header {
    position: sticky;
    top: -${MESSAGES_PADDING_TOP}px;
    z-index: 2;
    background-color: var(--b3-theme-background);
}
`;

export const mountAgentThinkingStickyHeader = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    return {};
};
