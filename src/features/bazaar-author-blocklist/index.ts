/**
 * 功能：按作者屏蔽在线集市列表里的包。
 *
 * 名单是设置面板里的一段多行文本，一行一个作者，与集市索引的 author 字段完全匹配
 * （忽略大小写）。只作用于「设置 → 集市」里五个在线列表页签，已下载与可更新列表不受影响。
 *
 * 列表是宿主自己整块重绘的（切换排序 / 筛选、虚拟化补卡都会重写容器内容），
 * 所以实现不缓存卡片节点，只跟着 DOM 变化重新对账；计数修正与「全部被屏蔽」提示
 * 另靠一份响应观察者拿到整份列表数据（列表是虚拟化的，DOM 里数不全）。
 */
import {defineFeature} from "../../core/types";
import {mountBazaarAuthorBlocklist} from "./apply";

export default defineFeature({
    id: "bazaar-author-blocklist",
    category: "settings",
    enabled: true,
    name: "feature.bazaarAuthorBlocklist.title",
    description: "feature.bazaarAuthorBlocklist.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "textarea",
            key: "authors",
            title: "feature.bazaarAuthorBlocklist.authors",
            description: "feature.bazaarAuthorBlocklist.authorsTip",
            placeholder: "feature.bazaarAuthorBlocklist.authorsPlaceholder",
            default: "",
            rows: 6,
        },
    ],
    mount: mountBazaarAuthorBlocklist,
});
