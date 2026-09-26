/**
 * 功能：与内核断开连接时立刻自己重试 n 次，间隔 n 毫秒。
 *
 * 完全独立于思源自身的自动重连：内核那条是 WebSocket `onclose` 里固定 3 秒、
 * 无上限的重试；本功能在断连面板出现时按自己的节奏（默认 2 次、间隔 500ms）
 * 探测内核，一旦探测到内核恢复就立刻重载前端，把主 WebSocket 重建起来，
 * 不再等那 3 秒。
 */
import {defineFeature} from "../../core/types";
import {mountKernelAutoReconnect} from "./reconnect";

export default defineFeature({
    id: "kernel-auto-reconnect",
    category: "function",
    name: "feature.kernelAutoReconnect.name",
    description: "feature.kernelAutoReconnect.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "attempts",
            title: "kernelAutoReconnect.attempts",
            description: "kernelAutoReconnect.attemptsTip",
            default: 2,
            min: 0,
            max: 20,
            step: 1,
            unit: "kernelAutoReconnect.times",
        },
        {
            kind: "number",
            key: "interval",
            title: "kernelAutoReconnect.interval",
            default: 500,
            min: 100,
            max: 10000,
            step: 100,
            unit: "ms",
        },
    ],
    mount: mountKernelAutoReconnect,
});
