/**
 * 界面：把智能体思考正文翻译成中文（或所选语言）再显示。
 *
 * 模型用英文思考时，思考卡片里成段英文读起来很吃力。这个功能在思考正文**展开后**
 * 按段调用免费翻译接口（微软 / 谷歌），把译文显示在原位置，随时可以切回原文。
 *
 * 三条边界：
 * - **只改显示**：原文节点、会话存档与模型上下文都不动，翻译结果也不落盘；
 * - **只在展开时翻**：折叠状态看不到正文，不发请求，在途请求立即取消；
 * - **流式尾巴不翻**：只翻已经结束的段落，正在追加的最后一段保留原文，
 *   避免每个 token 都发一次请求。
 *
 * 思考内容会发送到所选的外部翻译服务，这一点写进设置项的说明里。
 */
import {defineFeature} from "../../core/types";
import {mountAgentThinkingTranslate} from "./mount";

export default defineFeature({
    id: "agent-thinking-translate",
    category: "ai",
    enabled: true,
    name: "feature.agentThinkingTranslate.title",
    description: "feature.agentThinkingTranslate.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "select",
            key: "provider",
            title: "feature.agentThinkingTranslate.provider",
            description: "feature.agentThinkingTranslate.providerTip",
            default: "bing",
            options: [
                {value: "bing", label: "feature.agentThinkingTranslate.provider.bing"},
                {value: "google", label: "feature.agentThinkingTranslate.provider.google"},
            ],
        },
        {
            kind: "select",
            key: "target",
            title: "feature.agentThinkingTranslate.target",
            description: "feature.agentThinkingTranslate.targetTip",
            default: "auto",
            options: [
                {value: "auto", label: "feature.agentThinkingTranslate.target.auto"},
                {value: "zhCn", label: "feature.agentThinkingTranslate.target.zhCn"},
                {value: "zhTw", label: "feature.agentThinkingTranslate.target.zhTw"},
                {value: "en", label: "feature.agentThinkingTranslate.target.en"},
            ],
        },
        {
            kind: "number",
            key: "retries",
            title: "feature.agentThinkingTranslate.retries",
            description: "feature.agentThinkingTranslate.retriesTip",
            default: 2,
            min: 0,
            max: 5,
            step: 1,
        },
        {
            kind: "number",
            key: "retryInterval",
            title: "feature.agentThinkingTranslate.retryInterval",
            description: "feature.agentThinkingTranslate.retryIntervalTip",
            default: 1000,
            min: 200,
            max: 10000,
            step: 100,
            unit: "ms",
        },
    ],
    mount: mountAgentThinkingTranslate,
});
