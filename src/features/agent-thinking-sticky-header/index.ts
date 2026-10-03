/**
 * 界面：把智能体思考卡片的「已思考 N 秒」标题固定在面板顶部。
 *
 * 思考卡片是两层结构：标题（耗时文字 + 折叠箭头，整行可点）和正文（工具调用与思考内容）。
 * 正文展开后可以很长，标题会随对话一起滚出视野，要折叠就得先把卡片滚回顶部；
 * 长思考来回找那个箭头的体验很差。这里把标题改成粘性定位：它在**自己这张卡片内**
 * 固定 —— 滚过整张卡片后跟着卡片一起离开视野，不会浮到相邻消息上面。
 *
 * 只写 CSS 就够，不需要 JS：
 * - 唯一会滚动的祖先是消息容器（`overflow-y: auto`），它到标题之间没有任何一层
 *   `overflow`（卡片、消息项、外层包裹都不裁剪），所以粘性定位的参照系正好是那个容器；
 * - 标题的包含块就是卡片本身，粘性元素不会越过自己的包含块，天然限在卡片里。
 *
 * 必须补一层底色：标题是浮在正文之上的，没底色会和滚过去的思考内容叠字。
 * 取 `--b3-theme-background`（面板自己的底色，跟随主题）；已完成卡片整体带 `opacity`，
 * 标题底色与面板底色相同，分组叠出来仍是同一个颜色，不会显出「一条色带」。
 * 层级要高于正文：正文有 `contain: layout paint`（自带层叠上下文），标题用正数 `z-index` 压住它，
 * 但仍低于消息容器里的浮动按钮（回到底部按钮 z-index 5、导航轨 6）。
 *
 * 桌面端、移动端、以及编辑器里的 AI 面板共用这套类名，所以只写一条规则；
 * 在那些没有滚动祖先（例如 AI 面板用自己的局部滚动区）的地方，粘性定位不产生任何副作用。
 */
import {defineFeature} from "../../core/types";
import {mountAgentThinkingStickyHeader} from "./style";

export default defineFeature({
    id: "agent-thinking-sticky-header",
    category: "ui",
    name: "feature.agentThinkingStickyHeader.name",
    description: "feature.agentThinkingStickyHeader.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountAgentThinkingStickyHeader,
});
