/**
 * 功能：查看阿里云 OSS 存储桶的使用数据。
 *
 * 思源自己只显示同步快照的本地体积，看不到桶里到底占了多少、有多少对象；这个功能在
 * S3 存储配置页加一个按钮，用那里已经保存好的凭据去查桶的存储量与对象数，
 * 结果放在一个独立弹窗里。
 */
import {defineFeature} from "../../core/types";
import {mountOssUsage} from "./usage";

export default defineFeature({
    id: "oss-usage",
    category: "function",
    name: "feature.ossUsage.name",
    description: "feature.ossUsage.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountOssUsage,
});
