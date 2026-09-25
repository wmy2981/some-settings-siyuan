/**
 * 示例功能（分类：功能）。
 *
 * 目的只有一个：端到端验证「功能」分类的完整链路——
 * feature-control.json 四态 → 独立 JSON 配置文件 → 设置面板控件 → 保存后行为生效 → 卸载清理。
 *
 * 不注册任何按钮或面板：命令是最小侵入的可触发入口，
 * 具体实现放同目录的 demo.ts。
 */
import {defineFeature} from "../../core/types";
import {mountDemo} from "./demo";

export default defineFeature({
    id: "function-demo",
    category: "function",
    name: "feature.functionDemo.name",
    description: "feature.functionDemo.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "functionDemo.enabled",
            default: true,
        },
        {
            kind: "text",
            key: "text",
            title: "functionDemo.text",
            default: "Some Settings",
            placeholder: "functionDemo.defaultText",
        },
        {
            kind: "number",
            key: "delay",
            title: "functionDemo.delay",
            default: 0,
            min: 0,
            max: 5000,
            step: 100,
            unit: "ms",
        },
    ],
    mount: mountDemo,
});
