/**
 * 界面：移动端文档树标题字号回到 3.8.9。
 *
 * 思源在 3.8.10 把移动端侧栏列表的字号从 14px 改成 16px，一屏能看到的标题层级少了一截。
 * 本功能把文档树（以及同样走这份列表样式的侧栏列表）的标题字号按 3.8.9 的比例恢复，
 * 其它与大小相关的行为保持内核原样：两版之间只有字号这一处不同。
 *
 * 字号不是固定值：按思源「字体大小」设置等比缩放，默认 16px 时正好是 3.8.9 的 14px。
 */
import {defineFeature} from "../../core/types";
import {mountMobileDocTreeTitleSize} from "./style";

export default defineFeature({
    id: "mobile-doc-tree-title-size",
    category: "doc-tree",
    enabled: true,
    name: "feature.mobileDocTreeTitleSize.title",
    description: "feature.mobileDocTreeTitleSize.description",
    frontends: ["mobile"],
    // 字号改动是 3.8.10 才有的：3.8.9 及以前内核本来就是 14px，这份补丁无事可做，
    // 所以下限取它出现的那一版，更早的思源不再加载它的配置，设置面板里也不再出现这一项。
    minAppVersion: "3.8.10-alpha.1",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobileDocTreeTitleSize,
});
