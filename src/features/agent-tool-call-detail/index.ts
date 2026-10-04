/**
 * 界面：智能体思考卡片里的工具调用显示细节。
 *
 * 思源的思考卡片只把工具名画出来（`Tool calls: search block block …`），参数与结果一个都不显示，
 * 稍长一点的思考就完全看不出智能体到底做了什么。这里把每次调用的关键参数补在工具名后面，
 * 悬停还能看到完整参数与结果开头。
 *
 * 数据全部来自**面板自己已经收到的响应**：工具刚开始执行时的事件流给出参数，写回后的会话存档
 * 给出结果与整轮的权威数据（详见 `live.ts` 与 `session.ts`）。思源没有给插件留任何读取智能体会话
 * 的 API，我们不额外发请求、也不改动宿主的任何行为。两段数据接起来的效果是：工具一发起就能看到
 * 它的参数，结果一回来就补上，不必等这一轮结束。
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
