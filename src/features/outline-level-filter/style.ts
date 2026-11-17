/**
 * 大纲显示层级的实现：一段按当前层级生成的 CSS，外加搜索期间的临时放行。
 *
 * 两个关键点：
 *
 * 1. **必须同时隐藏 `li` 后面紧跟的 `ul`。** 思源的大纲树不是嵌套在 `li` 里面，
 *    而是 `<li>…</li><ul>…</ul>` 平铺（`app/src/util/Tree.ts` 的 `genHTML()`）；
 *    只隐藏 `li` 会把子级标题留在原地，缩进和层级都错。第二个 `+ ul + ul` 是防御性的：
 *    某个标题同时有子标题和子块时，`genHTML()` 会再跟一个 `ul`。
 *
 * 2. **搜索时必须整段停用。** 宿主的搜索（`Outline.setFilter()`）把不匹配的行写成行内
 *    `display: none`、把匹配的行写回行内空值，行内样式本来就压过样式表；但反过来，
 *    搜索期间还按层级隐藏，深层标题就永远搜不出来。所以搜索框有值时给面板根元素加
 *    `ss-outline-searching`，让下面这些选择器整条不匹配，搜索结束后再恢复。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 搜索框有值时挂在面板根元素上的类名：让层级过滤整段失效。 */
const SEARCHING_CLASS = "ss-outline-searching";

/**
 * 大纲面板的根元素。桌面端钉住的大纲与本地大纲都是 `.sy__outline`（`Outline.ts` 给页签
 * 容器加的类），移动端侧栏大纲是模板里那个 `[data-type="sidebar-outline"]`。
 */
const ROOTS = [".sy__outline", '[data-type="sidebar-outline"]'];
const ROOT_SELECTOR = ROOTS.join(", ");

/** 大纲面板的搜索框：桌面端与移动端用的是同一个类名。 */
const SEARCH_INPUT_SELECTOR = "input.b3-text-field.search__label";

/** 每个选项要隐藏的标题级别；`all` 一级都不隐藏。 */
const HIDDEN_LEVELS: Record<string, number[]> = {
    all: [],
    h2: [3, 4, 5, 6],
    h3: [4, 5, 6],
    h4: [5, 6],
    h5: [6],
};

const levelOf = (host: FeatureHost): string => {
    const level = String(host.config.level ?? "all");
    return level in HIDDEN_LEVELS ? level : "all";
};

const buildCss = (level: string): string => {
    const selectors: string[] = [];
    for (const root of ROOTS) {
        const scope = `${root}:not(.${SEARCHING_CLASS})`;
        for (const depth of HIDDEN_LEVELS[level]) {
            const item = `${scope} li[data-subtype="h${depth}"]`;
            // 标题行本身、它的子标题列表，以及它的子块列表
            selectors.push(item, `${item} + ul`, `${item} + ul + ul`);
        }
    }
    if (selectors.length === 0) {
        // 只留一段注释而不是空串：`addStyle` 收到空白内容时不会改写已有的样式表，
        // 万一走到这条路上，旧层级的规则就会留在页面上继续生效。
        return "/* 大纲显示全部标题级别 */\n";
    }
    return `/* 大纲只显示到指定标题级别 */\n${selectors.join(",\n")} {\n    display: none;\n}\n`;
};

export const mountOutlineLevelFilter = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        const level = levelOf(host);
        host.addStyle(buildCss(level));
        host.log.info(`outline shows headings up to ${level === "all" ? "every level" : `h${level.slice(1)}`}`);
    };

    /**
     * 搜索框有值时放行全部层级。
     *
     * 判据是「非空」而不是「去掉空白后非空」：宿主的搜索用的是 `trim: false`
     * （标题里可能带首尾空格，空白本身就是一个合法查询），只要输入框里有内容它就会筛选，
     * 这里跟着它走才不会在筛选期间还把深层标题藏起来。
     */
    const syncSearching = (input: HTMLInputElement) => {
        const root = input.closest(ROOT_SELECTOR);
        if (!root) {
            return;
        }
        const searching = input.value !== "";
        if (root.classList.contains(SEARCHING_CLASS) === searching) {
            return;
        }
        root.classList.toggle(SEARCHING_CLASS, searching);
        host.log.info(
            searching ?
                "outline search started: every level is shown while it is active" :
                "outline search cleared: the level limit applies again",
        );
    };

    // 输入法组字期间宿主还没开始筛选，这里提前放行只会多显示几行、不会藏掉内容，
    // 所以不按 `isComposing` 跳过，始终以输入框里的实际内容为准。
    const onInput = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const input = target.closest(SEARCH_INPUT_SELECTOR);
        if (input instanceof HTMLInputElement) {
            syncSearching(input);
        }
    };

    apply();
    host.onConfigChange(apply);
    document.addEventListener("input", onInput, true);
    // 挂载时面板可能已经开着、搜索框里已经有词，先补一次
    document.querySelectorAll(SEARCH_INPUT_SELECTOR).forEach((input) => {
        if (input instanceof HTMLInputElement) {
            syncSearching(input);
        }
    });

    return {
        destroy: () => {
            document.removeEventListener("input", onInput, true);
            document.querySelectorAll(`.${SEARCHING_CLASS}`).forEach((root) => root.classList.remove(SEARCHING_CLASS));
            host.log.info("unmounted: every heading level is shown again");
        },
    };
};
