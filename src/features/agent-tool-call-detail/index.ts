/**
 * 界面：智能体思考卡片里的工具调用显示细节。
 *
 * 思源的思考卡片只把工具名画出来（`Tool calls: search block block …`），参数与结果一个都不显示，
 * 稍长一点的思考就完全看不出智能体到底做了什么。这里把每次调用的关键参数补在工具名后面，
 * 悬停还能看到完整参数与结果开头。
 *
 * 数据取自**会话存档**（详见 `session.ts`）：思源没有给插件留任何读取智能体会话的 API，
 * 但面板本来就会请求存档接口，我们只是被动读一遍已经回来的响应，不额外发请求、
 * 也不改动宿主的任何行为。代价是细节出现的时机跟着存档走 —— 这一轮写回存档之后
 * （本轮结束、或中途写回时）才会补上；写回之前工具行仍是思源原样，只有名字。
 *
 * 桌面端与移动端的智能体面板共用同一套渲染，两端都适用。
 */
import {defineFeature} from "../../core/types";
import {mountAgentToolCallDetail} from "./detail";

export default defineFeature({
    id: "agent-tool-call-detail",
    category: "ui",
    name: "feature.agentToolCallDetail.name",
    description: "feature.agentToolCallDetail.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountAgentToolCallDetail,
});
