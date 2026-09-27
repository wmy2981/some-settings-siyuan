/**
 * 功能：智能体面板顶栏显示 DeepSeek 余额。
 *
 * 用官网（`api.deepseek.com`）的 DeepSeek 模型时，自动取思源「设置 - 人工智能」里
 * 已经配置好的 API Key，定时查一次余额，把实时数字显示在智能体面板顶栏。
 *
 * 不注册任何顶栏 / 停靠栏 / 页签入口 —— 面板顶栏那一段是自己注入的，
 * 所以功能关着（根本不会被挂载）时不会有任何残留。
 */
import {defineFeature} from "../../core/types";
import {mountDeepseekBalance} from "./balance";

export default defineFeature({
    id: "deepseek-balance",
    category: "function",
    name: "feature.deepseekBalance.name",
    description: "feature.deepseekBalance.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "interval",
            title: "deepseekBalance.interval",
            description: "deepseekBalance.intervalTip",
            default: 30,
            min: 1,
            max: 3600,
            step: 1,
            unit: "deepseekBalance.seconds",
        },
    ],
    mount: mountDeepseekBalance,
});
