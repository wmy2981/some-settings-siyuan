/**
 * 界面：折叠 / 展开思考卡片之后把视图对准这张卡片。
 *
 * 标题吸顶（见 `style.ts`）让用户在长思考中间就能点标题折叠，但折叠会把正文那一整段高度抽掉：
 * 卡片随即整个滑到滚动区上沿之上，粘性标题跟着离开视野，这张思考下方的输出段落也被后面的内容
 * 顶到看不见的地方。所以这里在点击之后把卡片的**顶沿**对回滚动区上沿 —— 标题重新贴住面板顶部，
 * 紧跟其后的输出段落正好落在它下面（与思源自己在思考结束时「定位到思考卡片下方」是同一个意图）。
 *
 * 只在「卡片整个滑到上沿之上」时才动滚动位置：展开不会让卡片往上走，卡片还在视野里时用户也没丢位置，
 * 这两种情况一律不碰滚动，免得替用户猜他想停在哪。
 *
 * 折叠动画（`max-height` 过渡）期间卡片高度是一帧一帧变的，所以点击后先立即对一次，过渡结束后再看一眼；
 * 两次都受同一个判断约束，因此重复调用是空操作。
 */
/** 整行可点的标题；思考卡片的折叠开关就挂在它上面。 */
const HEADER_SELECTOR = ".agent-chat__thinking-header";
/** 思考卡片本身（重试卡片用的是另一套类名，不受影响）。 */
const CARD_SELECTOR = ".agent-chat__msg--thinking";
/** 折叠过渡的时长：与思源 `.agent-chat__thinking-body` 的 `transition` 一致，再放宽一点。 */
const SETTLE_MS = 240;

/** 卡片之外最近的那个纵向滚动区；没有就返回 undefined。 */
const scrollerOf = (element: HTMLElement): HTMLElement | undefined => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflow = window.getComputedStyle(parent).overflowY;
        if (overflow === "auto" || overflow === "scroll") {
            return parent;
        }
    }
    return undefined;
};

/**
 * 把卡片顶沿对回滚动区上沿。
 *
 * 卡片还在上沿之下（露在视野里）就什么都不做 —— 那时它自己就是用户的参照物。
 */
const alignCardToTop = (card: HTMLElement) => {
    const scroller = scrollerOf(card);
    if (!scroller) {
        return;
    }
    const cardRect = card.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    if (cardRect.bottom > scrollerRect.top) {
        return;
    }
    const max = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollTop + cardRect.top - scrollerRect.top, max));
};

export const anchorThinkingCard = (): () => void => {
    let timer = 0;
    const settle = (card: HTMLElement) => {
        if (card.isConnected) {
            alignCardToTop(card);
        }
    };
    const onClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const card = target.closest(HEADER_SELECTOR)?.closest(CARD_SELECTOR);
        if (!(card instanceof HTMLElement)) {
            return;
        }
        if (timer) {
            window.clearTimeout(timer);
        }
        // 立刻对一次（折叠是瞬间完成的），动画结束后再看一眼
        window.requestAnimationFrame(() => settle(card));
        timer = window.setTimeout(() => {
            timer = 0;
            settle(card);
        }, SETTLE_MS);
    };
    // 捕获阶段只听不动：宿主的折叠逻辑挂在标题自己身上，谁先谁后都不影响下一帧再动手
    document.addEventListener("click", onClick, true);
    return () => {
        document.removeEventListener("click", onClick, true);
        if (timer) {
            window.clearTimeout(timer);
            timer = 0;
        }
    };
};
