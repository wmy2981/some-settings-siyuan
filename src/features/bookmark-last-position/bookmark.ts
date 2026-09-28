/**
 * 「书签打开笔记跳到上次位置」的实现。
 *
 * 内核给"上次位置"留了两条通道（见 `local-fileposition` 那份存储）：
 * 只有动作里带 `cb-get-scroll` 才会真正去恢复它 —— 文档树打开笔记走的就是这条。
 * 书签那条路给的是 `cb-get-rootscroll`（桌面）与 `cb-get-hl/cb-get-context/cb-get-rootscroll`
 * （移动端），都**不含** `cb-get-scroll`，于是位置恢复根本没被触发，
 * 最后落到「定位到文档标题」＝看起来跳回了开头。
 *
 * 所以这里只做一件事：在书签列表里接管"整篇文档书签"的左键单击，
 * 换成和文档树同一套动作重新打开一次（桌面 `openTab`、移动端 `openMobileFileById`）。
 * 不自己算滚动位置，也不去补滚动：恢复过程（分段加载、光标定位、长文档的反复补偿）
 * 全部交给内核原有那条通道，效果才与文档树打开完全一致。
 *
 * 只认整篇文档的书签：书签加在块上时（`data-type` 不是 `NodeDocument`）不接管，
 * 内核怎么跳就怎么跳 —— 那种书签本来就要跳到那个块。
 */
import {
    openMobileFileById,
    openTab,
} from "siyuan";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 桌面端书签面板与移动端书签列表。 */
const PANELS = [".sy__bookmark", ".bookmarkList"];
/**
 * 整篇文档的书签行。
 *
 * 每个分支都写全「面板 + 行」，不能把面板选择器单独拼在前面：逗号分隔的选择器里
 * 后半截只约束最后一项。
 */
const ITEM_SELECTOR = PANELS.map((panel) => `${panel} li[data-node-id][data-type="NodeDocument"]`).join(", ");
/** 这两个地方有自己的行为（更多菜单、展开折叠），不能被我们抢走。 */
const OWN_HANDLERS = ".b3-list-item__action, .b3-list-item__toggle";

/** 与文档树打开笔记完全一致的动作。 */
const DESKTOP_ACTION = ["cb-get-focus", "cb-get-scroll"] as const;
const MOBILE_ACTION = ["cb-get-scroll"] as const;

export const mountBookmarkLastPosition = (host: FeatureHost): FeatureInstance => {
    const open = (id: string) => {
        if (isMobile()) {
            openMobileFileById(host.plugin.app, id, [...MOBILE_ACTION]);
            return;
        }
        openTab({
            app: host.plugin.app,
            doc: {id, action: [...DESKTOP_ACTION]},
        });
    };

    const onClick = (event: MouseEvent) => {
        // 只接管干净的左键单击：带修饰键的是「新页签 / 分屏 / 不跳转」这些另一套语义，
        // 交给内核自己处理，我们不猜。
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element) || target.closest(OWN_HANDLERS)) {
            return;
        }
        const item = target.closest<HTMLElement>(ITEM_SELECTOR);
        const id = item?.dataset.nodeId;
        if (!id) {
            return;
        }
        // 拦下内核自己那次点击，换成带 cb-get-scroll 的一次打开
        event.stopPropagation();
        open(id);
    };

    document.addEventListener("click", onClick, true);

    return {
        destroy: () => {
            document.removeEventListener("click", onClick, true);
        },
    };
};
