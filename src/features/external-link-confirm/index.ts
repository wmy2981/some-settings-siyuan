/**
 * 功能：跳转 web 链接前弹出 modal 询问，modal 里显示原始链接。
 */
import {defineFeature} from "../../core/types";
import {mountExternalLinkConfirm} from "./confirm";

export default defineFeature({
    id: "external-link-confirm",
    category: "function",
    name: "feature.externalLinkConfirm.name",
    description: "feature.externalLinkConfirm.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountExternalLinkConfirm,
});
