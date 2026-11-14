/**
 * 思源原生风格的 UI 基元。
 *
 * 所有类名与结构都刻意对齐内核设置面板的真实渲染器
 * （app/src/config/render/render.ts、fragments.ts、config/tabs/*），
 * 目标是让插件设置面板与「设置」里的原生面板逐像素一致：
 * 左侧文案（标题 + 灰色小字说明）在左，控件靠右固定宽度。
 *
 * 面板按页签组织，每个分类（按作用到的原生功能划分）各占一个页签，页签本身两套外观：
 *
 *   .some-settings-panel--tabs                    桌面端：左右分栏
 *     .some-settings-panel__side       页签列表（.b3-list-item，照抄内核设置左侧）
 *     .some-settings-panel__views      页签内容
 *       .some-settings-panel__view    一个分类
 *         .config-items
 *           .b3-label.config-item     功能名小节标题
 *           .b3-label.config-item     设置行
 *           ...                       行与行之间保留内核自带的分割线
 *
 *   .some-settings-panel--tabs.some-settings-panel--mobile   移动端：上下分栏
 *     .layout-tab-bar                 顶部页签（照抄内核代码片段弹窗）
 *     .some-settings-panel__views     同上
 *
 * 页签内部仍然是扁平的一层：行直接排在 `.config-items` 里，
 * 任何一层多余的分组容器都会让面板重新长出层级。
 */
import {getFrontend} from "siyuan";
import type {FeatureCategory} from "./types";

/** 面板内的作用域类名，用于在插件自己的 CSS 里限定样式，不污染全局。 */
export const PANEL_CLASS = "some-settings-panel";

/**
 * 子设置行的类名。
 *
 * 功能名那一行是 `__sub`（`subtitleRowHtml`），它下面的每一行 —— 参数、说明块、动作行 ——
 * 都带这个类。面板只靠它做缩进，功能声明里不用写任何东西。
 *
 * 下面这些行构造器只有 `subtitleRowHtml` 产出主行，其余六个都只用于子行
 * （全部由 `setting-dialog.ts` 的 `fieldHtml()` 调用），所以类名直接写在它们里面，
 * 调用方不需要再传一个「这一行是子行」的开关。以后加新的行类型也照这个约定写。
 */
export const CHILD_CLASS = `${PANEL_CLASS}__child`;

/**
 * 「一个功能的最后一个子行」的标记类名。
 *
 * 子行是平铺在 `.config-items` 里的（页签内不允许分组容器），CSS 的 `:last-child`
 * 看见的是整页最后一行、而不是某个功能的最后一个子行。层级引导线要在最后一个子行上收尾
 * （画成 └，而不是一直画到行底、看起来像还有下一项），所以这一处只能由
 * `setting-dialog.ts` 拼行时显式标记，用法与 `config-item--last-visible` 相同。
 */
export const LAST_CHILD_CLASS = `${CHILD_CLASS}--last`;

/**
 * 给一段「某个功能名下面的全部子行」HTML 里的最后一行打上 `LAST_CHILD_CLASS`。
 *
 * 与 `setting-dialog.ts` 的 `markLastRow()` 同一套做法：认的是最后一个带 `CHILD_CLASS`
 * 这个整词的 class 属性 —— 说明块这类行内部还有自己的元素与 class（段落是
 * `b3-label__text`），照着最后一个 class 属性下手会标记到段落的头上。
 * 没有子行（功能只有一个开关）时原样返回。
 */
export const markLastChildRow = (rowsHtml: string): string => {
    const pattern = /class="([^"]*)"/g;
    let index = -1;
    let match = pattern.exec(rowsHtml);
    while (match) {
        if (match[1].split(/\s+/).includes(CHILD_CLASS)) {
            index = match.index;
        }
        match = pattern.exec(rowsHtml);
    }
    if (index < 0) {
        return rowsHtml;
    }
    const head = rowsHtml.slice(0, index + 'class="'.length);
    const tail = rowsHtml.slice(index + 'class="'.length);
    return `${head}${LAST_CHILD_CLASS} ${tail}`;
};

export const isMobileFrontend = (): boolean => {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
};

/** 五个需要转义的字符及其替换文本。 */
const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

const HTML_ESCAPE_PATTERN = /[&"'<>]/g;

/**
 * 转义要写进 HTML 的文案。
 *
 * 一次 `replace` 扫完整串：面板渲染一次要转义几百段文案，连着五趟正则各扫一遍
 * 会多分配四份中间字符串。输出与逐字符替换完全一致。
 */
export const escapeHtml = (value: string): string => value.replace(HTML_ESCAPE_PATTERN, (char) => HTML_ESCAPES[char]);

/** 原生「主文案 + 说明」块。 */
export const mainHtml = (title: string, description?: string): string =>
    `<div class="fn__flex-1 config-item__main">${escapeHtml(title)}${
        description ? `<div class="b3-label__text">${escapeHtml(description)}</div>` : ""
    }</div>`;

/**
 * 一个页签。
 *
 * 页签的内容就是功能分类，所以 id 直接用 `FeatureCategory`，一个分类只会有一个页签。
 * 图标用思源内置 symbol 的名字（如 `iconBug`），内核会把当前图标主题的 symbol 内联进页面。
 */
export interface PanelTab {
    id: FeatureCategory;
    label: string;
    icon: string;
}

/**
 * 面板搜索框。
 *
 * 两端各放在自己的位置上（由 `tabViewsHtml` 与 `setting-dialog.ts` 决定）：
 * 桌面端在内容区顶部、设置行上方（页签栏左侧那条不变）；移动端在面板标题下方、页签栏上方。
 * 刻意用 `type="text"` 而不是 `type="search"`：浏览器的原生清除按钮样式不受主题控制，
 * 面板自己放一颗（输入框内右侧、纯图标、思源内置 `iconClose`，有内容才出现）。
 */
export const searchBoxHtml = (placeholder: string, clearLabel: string): string =>
    `<div class="${PANEL_CLASS}__search">
    <div class="${PANEL_CLASS}__search-field">
        <input class="b3-text-field" type="text" data-ss-search="1" role="searchbox"
        autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder)}" aria-label="${
        escapeHtml(placeholder)
    }"/>
        <button class="${PANEL_CLASS}__search-clear fn__none" type="button" data-ss-search-clear="1"
        aria-label="${escapeHtml(clearLabel)}" title="${escapeHtml(clearLabel)}">
            <svg><use xlink:href="#iconClose"></use></svg>
        </button>
    </div>
</div>`;

/** 页签列表（桌面端：弹窗左侧的一列，照抄内核设置的 `.config__side`）。 */
export const tabSideHtml = (itemsHtml: string): string =>
    `<div class="${PANEL_CLASS}__side b3-list b3-list--background">
    <ul class="${PANEL_CLASS}__tabs" role="tablist" tabindex="-1">${itemsHtml}</ul>
</div>`;

/**
 * 页签栏（移动端：弹窗顶部一条，照抄内核代码片段弹窗的 `.layout-tab-bar`）。
 *
 * 左右两侧各一个 `fn__flex-1` 把文字夹在中间，这是内核那份标记的写法，
 * 少一个就会让文字贴边。
 */
export const tabBarHtml = (itemsHtml: string): string =>
    `<div class="layout-tab-bar fn__flex fn__flex-shrink">${itemsHtml}</div>`;

/** 页签图标：桌面端与移动端显示同一个 symbol。 */
const tabIconHtml = (tab: PanelTab): string =>
    `<svg class="${PANEL_CLASS}__tab-icon"><use xlink:href="#${tab.icon}"></use></svg>`;

export const tabItemHtml = (tab: PanelTab, active: boolean, mobile: boolean): string => {
    if (mobile) {
        // 移动端页签栏是可以左右滑动的一整条：每一项按内容给宽度、不参与收缩，
        // 所以这里不再用两个 fn__flex-1 把文字夹在中间 —— 那样每一项都会抢宽度，
        // 页签一多就全挤成等分，滑都滑不动。
        return `<div class="${PANEL_CLASS}__tab item${active ? " item--focus" : ""}"
    data-ss-tab="${tab.id}" role="tab" tabindex="0"${active ? ' aria-selected="true"' : ""}>
    ${tabIconHtml(tab)}
    <span class="item__text">${escapeHtml(tab.label)}</span>
</div>`;
    }
    return `<li class="b3-list-item ${PANEL_CLASS}__tab${active ? " b3-list-item--focus" : ""}"
    data-ss-tab="${tab.id}" role="tab" tabindex="0"${active ? ' aria-selected="true"' : ""}>
    <svg class="b3-list-item__graphic"><use xlink:href="#${tab.icon}"></use></svg>
    <span class="b3-list-item__text">${escapeHtml(tab.label)}</span>
</li>`;
};

/** 页签内容区：每一页都铺满它，只有当前页可见（其余带 `fn__none`）。 */
export const tabPaneHtml = (id: string, bodyHtml: string, active: boolean): string =>
    `<div class="${PANEL_CLASS}__view${active ? "" : " fn__none"}" data-ss-tab-panel="${id}" role="tabpanel">
    <div class="config-items">${bodyHtml}</div>
</div>`;

/**
 * 搜索结果里一个分类的分组标题。
 *
 * 它排在页签内容的第一行，平时带 `fn__none` 收起 —— 搜索结果要把所有命中的分类拼成一列，
 * 分类名就是那一组的分组标题，而普通状态下分类由页签表达，标题不该出现。
 */
export const searchGroupHtml = (category: string, label: string): string =>
    `<div class="${PANEL_CLASS}__group fn__none" data-ss-search-group="${escapeHtml(category)}">${
        escapeHtml(label)
    }</div>`;

/**
 * 页签内容区：顶部一块搜索框（移动端传空串，搜索框在面板标题下方），下面是一叠页签。
 *
 * 搜索框是滚动容器**外面**的一行：桌面端每一页自己滚、搜索时由 `.some-settings-panel__panes`
 * 滚，两种情况下搜索框都留在内容区顶部，不会被内容顶走，也不额外吸顶。
 * `trailingHtml`（无结果提示）放在页签容器里，跟着结果一起滚。
 */
export const tabViewsHtml = (searchHtml: string, panesHtml: string, trailingHtml = ""): string =>
    `<div class="${PANEL_CLASS}__views">${searchHtml}<div class="${PANEL_CLASS}__panes">${panesHtml}${trailingHtml}</div></div>`;

/** 开关控件本体（不含行容器）：功能自己那一行与参数行共用同一份标记。 */
export const switchControlHtml = (
    key: string,
    label: string,
    checked: boolean,
    disabled = false,
): string =>
    `<input class="b3-switch fn__flex-center" type="checkbox" data-ss-switch="${escapeHtml(key)}" aria-label="${
        escapeHtml(label)
    }"${checked ? " checked" : ""}${disabled ? " disabled" : ""}/>`;

/** 下拉控件本体（不含行容器）。 */
export const selectControlHtml = (
    key: string,
    options: {value: string; label: string;}[],
    current: string,
    disabled = false,
): string =>
    `<select class="b3-select fn__flex-center fn__size200" data-ss-select="${escapeHtml(key)}"${
        disabled ? " disabled" : ""
    }>
    ${
        options.map((option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === current ? " selected" : ""}>${
                escapeHtml(option.label)
            }</option>`
        ).join("")
    }
    </select>`;

/**
 * 功能自己的那一行：功能名 + 说明，右边直接跟它的开关。
 *
 * 开关不单独占一行：功能只有开关时，那样会多出一个孤零零的「启用」行；
 * 功能还有别的参数时，「启用」又会插在功能说明和它的参数之间——两种都不好看。
 * 开关跟着功能名走之后，面板里就只剩一种行：左边文案、右边控件。
 * 拿 selector 当开关的功能同理，「显示方式」也不再单独占一行（见 setting-dialog.ts）。
 *
 * 它照样带内核的分割线——分割线在功能行与它下面的第一个参数行之间必须留着，
 * 否则参数会看起来像挂在功能名上。
 */
export const subtitleRowHtml = (
    title: string,
    description?: string,
    control?: {key: string; html: string; toggles?: boolean;},
): string => {
    if (!control) {
        return `<div class="b3-label config-item ${PANEL_CLASS}__sub">${mainHtml(title, description)}</div>`;
    }
    // 整行可点：右边是开关时用 label 包住整行，点功能名（或它的说明）就等于点开关。
    // 这与 switchRowHtml 的做法一致，也就是内核设置页里「点条目即切换」的行为。
    // 拿下拉当开关的功能不能用 label：点功能名会顺手把下拉拉开，那是另一回事。
    const tag = control.toggles ? "label" : "div";
    return `<${tag} class="fn__flex b3-label config-item ${PANEL_CLASS}__sub" data-ss-row="${escapeHtml(control.key)}">
    ${mainHtml(title, description)}
    <span class="fn__space"></span>
    ${control.html}
</${tag}>`;
};

/** 原生风格的开关行。 */
export const switchRowHtml = (
    key: string,
    title: string,
    checked: boolean,
    description?: string,
    disabled = false,
): string =>
    `<label class="fn__flex b3-label config-item ${CHILD_CLASS}" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, description)}
    <span class="fn__space"></span>
    ${switchControlHtml(key, title, checked, disabled)}
</label>`;

/** 原生风格的下拉行。 */
export const selectRowHtml = (
    key: string,
    title: string,
    options: {value: string; label: string;}[],
    current: string,
    description?: string,
    disabled = false,
): string =>
    `<div class="fn__flex b3-label config-item ${CHILD_CLASS}" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, description)}
    <span class="fn__space"></span>
    ${selectControlHtml(key, options, current, disabled)}
</div>`;

/** 原生风格的数字行，带单位时结构与内核一致。 */
export const numberRowHtml = (
    key: string,
    title: string,
    value: number,
    options: {min?: number; max?: number; step?: number; unit?: string; description?: string; disabled?: boolean;} = {},
): string => {
    const input = `<input class="b3-text-field ${options.unit ? "fn__flex-1" : "fn__flex-center fn__size200"}"
    type="number" data-ss-number="${escapeHtml(key)}" value="${value}"
    min="${typeof options.min === "number" ? options.min : ""}"
    max="${typeof options.max === "number" ? options.max : ""}"
    step="${typeof options.step === "number" ? options.step : ""}"${options.disabled ? " disabled" : ""}/>`;
    // 单位用独立 span 承载（内核用的是 fn__flex-center，窄屏下会被压成一列一个字）
    const control = options.unit ?
        `<div class="fn__size200 fn__flex-center fn__flex config-item__number">${input}<span class="fn__space"></span><span class="config-item__unit ft__on-surface">${
            escapeHtml(options.unit)
        }</span></div>` :
        input;
    return `<div class="fn__flex b3-label config-item ${CHILD_CLASS}" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, options.description)}
    <span class="fn__space"></span>
    ${control}
</div>`;
};

/** 原生风格的文本行。 */
export const textRowHtml = (
    key: string,
    title: string,
    value: string,
    options: {placeholder?: string; description?: string; disabled?: boolean;} = {},
): string =>
    `<div class="fn__flex b3-label config-item ${CHILD_CLASS}" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, options.description)}
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="text" data-ss-text="${escapeHtml(key)}"
    spellcheck="false" value="${escapeHtml(value)}"${
        options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ""
    }${options.disabled ? " disabled" : ""}/>
</div>`;

/** 动作按钮的外观选项：动作行与说明块底部的按钮共用。 */
export interface ActionButtonOptions {
    disabled?: boolean;
    /** `outline`（默认）：次要按钮；`block`：撑满所在容器，形制照思源「关于」页那颗捐赠按钮。 */
    appearance?: "outline" | "block";
    /** `block` 的底色：`primary`（默认，思源主题色）或 `pink`（思源捐赠按钮那颗粉）。 */
    tone?: "primary" | "pink";
    /** 文字前的思源内置 symbol 名（如 `iconGithub`）。 */
    icon?: string;
    /** 文字前的现成 SVG 标记，原样插入：思源自己那张赞助图标就没有对应 symbol。 */
    iconSvg?: string;
    /** 由调用方补的位置类：同一颗按钮放在动作行里与放在说明块里，宽度来源不同。 */
    className?: string;
}

/**
 * 动作按钮本体（不含行容器）。
 *
 * 只借思源自己的类：`b3-button` 打底，`b3-button--outline` 是设置里那种次要按钮，
 * `b3-button--pink` 正是「关于」页捐赠按钮的底色；图标用 `b3-button__icon` 包一个内置 symbol。
 */
export const actionButtonHtml = (
    key: string,
    label: string,
    options: ActionButtonOptions = {},
): string => {
    // iconSvg 是调用方给的现成标记（思源那张赞助图），原样插入；symbol 才包一层图标类
    const icon = options.iconSvg ??
        (options.icon ?
            `<svg class="b3-button__icon"><use xlink:href="#${escapeHtml(options.icon)}"></use></svg>` :
            "");
    const modifier = options.appearance === "block" ?
        (options.tone === "pink" ? " b3-button--pink" : "") :
        " b3-button--outline";
    const classes = `b3-button${modifier}${options.className ? ` ${options.className}` : ""}`;
    const disabled = options.disabled ? " disabled" : "";
    return `<button class="${classes}" type="button" data-ss-button="${escapeHtml(key)}"${disabled}>${icon}${
        escapeHtml(label)
    }</button>`;
};

/**
 * 原生风格的动作行：右侧一个按钮。
 *
 * 只用于「点击即打开某个窗口」这类没有可持久化取值的入口。
 * 按钮不参与草稿：点击立刻执行，不受「取消 / 保存」影响。
 *
 * 外观两套：默认是靠右定宽 `fn__size200` 的次要按钮；`block` 则是外壳 `fn__size200` +
 * 按钮 `fn__block`，与思源「关于」页那颗捐赠按钮同构，窄屏时外壳由面板媒体查询放开到整行。
 */
export const buttonRowHtml = (
    key: string,
    title: string,
    label: string,
    options: ActionButtonOptions & {description?: string;} = {},
): string => {
    const button = options.appearance === "block" ?
        actionButtonHtml(key, label, {...options, className: "fn__block"}) :
        actionButtonHtml(key, label, {...options, className: "fn__flex-center fn__size200"});
    const control = options.appearance === "block" ?
        `<div class="fn__flex-center fn__size200">${button}</div>` :
        button;
    return `<div class="fn__flex b3-label config-item ${CHILD_CLASS}" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, options.description)}
    <span class="fn__space"></span>
    ${control}
</div>`;
};

/**
 * 只读说明块的正文：一行一段，`{name}` 占位符按 values 替换。
 *
 * 文案先整体转义再替换，替换值本身是 http(s) 链接时渲染成可点的链接，其余一律是纯文本：
 * 说明块的文字来自 i18n 与功能声明，不允许直接注入 HTML。
 * 链接文字默认就是地址本身；`labels` 里给了同名的短写时用短写，地址仍然是完整的那个。
 */
export const noteBodyHtml = (
    text: string,
    values: Record<string, string> = {},
    labels: Record<string, string> = {},
): string =>
    escapeHtml(text).replace(/\{(\w+)\}/g, (placeholder: string, name: string) => {
        const value = values[name];
        if (typeof value !== "string") {
            return placeholder;
        }
        const safe = escapeHtml(value);
        return /^https?:\/\//i.test(value) ?
            `<a href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(labels[name] ?? value)}</a>` :
            safe;
    }).split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => `<div class="b3-label__text">${line}</div>`)
        .join("");

/**
 * 只读说明块：整行铺满的文字，右侧没有控件。
 *
 * 刻意不带 `fn__flex` —— 面板里其余每一行都是「左侧文案 + 右侧控件」，
 * 说明块不是设置项，没有控件可放，文案必须占满整行。
 *
 * `actionsHtml` 是这段说明配套的一组按钮：它们属于这段说明，不另起设置行。
 * 有按钮时整行变成和其它行一样的「左侧文案 + 右侧控件」：文字占满剩余宽度，
 * 按钮在右侧竖着叠、每颗 200px —— 与「导出配置」那些按钮同一个位置、同一个宽度。
 */
export const noteRowHtml = (key: string, bodyHtml: string, actionsHtml = ""): string =>
    `<div class="b3-label config-item ${PANEL_CLASS}__note ${CHILD_CLASS}" data-ss-row="${escapeHtml(key)}">
    <div class="${PANEL_CLASS}__note-body">${bodyHtml}</div>${
        actionsHtml ? `<div class="${PANEL_CLASS}__note-actions">${actionsHtml}</div>` : ""
    }
</div>`;

/**
 * 面板的全部局部样式：只在插件自己的弹窗作用域内生效。
 *
 * 结构、类名与间距全部照抄「设置页 + 参考插件面板」那套做法，插件只动四件事：
 * - 去掉 .config-items 的灰底大圆角，面板不再有"卡片"这件多余的东西
 * - 文案只有两种角色：设置项名（标题，一律常规字重）与说明（更小、更淡）
 * - 页签只有两套外观：桌面端照抄内核设置的左侧页签列表，
 *   移动端照抄内核代码片段弹窗的顶部页签栏（`.layout-tab-bar` 的样式由内核提供，
 *   这里把底色换成弹窗容器的底色让页签栏能吸顶，并去掉自己那圈圆角）
 * - 桌面端每一页自己滚动；移动端是宿主渲染的底部抽屉，整块按自然高度排版、
 *   由宿主的内容区滚动，页签栏吸顶
 * - 窄屏（≤750px，与内核同一断点）把行内边距压到 8px 10px、页签内容压到 8px：
 *   内核给 .b3-label 的 16px 24px 在手机上会吃掉近一半屏宽，这是"边距特别大"的主因
 * 桌面端的行内边距与行间分割线完全交给内核 .b3-label，不做任何覆盖。
 */
export const PANEL_CSS = `
.${PANEL_CLASS} {
    display: flex;
    height: 100%;
}
/* 移动端：顶部页签栏 + 内容，上下分栏，且按内容自然高度排版。
   宿主把 Setting 渲染成底部抽屉时，抽屉高度是「内容的自然高度」再按视口裁限，
   所以这里绝不能写死高度（height: 100% 在自动高度的父级里会退化成 auto，
   抽屉会塌成一条）；整块由宿主的内容区滚动，页签栏吸顶。 */
.${PANEL_CLASS}--mobile {
    flex-direction: column;
    height: auto;
}
/* 页签栏吸顶后必须有底色遮住从它下面滚过的行。取 --b3-theme-surface，
   与弹窗容器（含移动端底部抽屉）的底色完全一致；不能用内核给 .layout-tab-bar 的
   --b3-theme-background：深色主题下 1e1e1e 与 2c2c2c、浅色主题下 fff 与 f6f6f6
   都不一样，页签栏会变成标题下面一条明显的色带。
   同理不要圆角：本面板上面还有标题栏，不在容器圆角上，那圈圆角只会把容器底色从两个角上露出来。 */
.${PANEL_CLASS}--mobile > .layout-tab-bar {
    position: sticky;
    top: 0;
    z-index: 2;
    flex-shrink: 0;
    background-color: var(--b3-theme-surface);
    /* 页签按原生功能区划分后有七个，一屏放不下：整条可以左右滑动，
       每一项按内容给宽度（flex: 0 0 auto），不做等分也不换行。
       刻意不加 scroll-snap：吸附会在每一项上顿一下，手指的惯性被打断，滑起来是「一格一格」的黏感；
       页签本来就短，靠惯性滑到看得见的位置比被吸附到整项更顺手。 */
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    /* 搜索时这一条也要收起来，过渡与桌面端左侧栏一套时长、一条曲线。
       高度是内容撑出来的 auto，auto → 0 不能过渡：JS 在收起前把实测高度写进
       --ss-tabbar-height 当起点（见 core/setting-dialog.ts 的 lockTabBarHeight），
       这里只负责两端与时长，和左侧栏那段 width 过渡同一个写法。
       border-box 是为了让 JS 量到的 offsetHeight 直接能当 height 用（含那条 1px 底边）。 */
    box-sizing: border-box;
    height: var(--ss-tabbar-height, auto);
    transition: height .2s ease, opacity .12s ease, visibility 0s;
}
.${PANEL_CLASS}--mobile > .layout-tab-bar::-webkit-scrollbar {
    display: none;
}
/* 搜索时收起页签栏：高度收到 0、淡出，收完之后才真正隐身（点不到、Tab 不到），
   展开时这个延时为 0，一有高度就看得见 —— 与桌面端左侧栏的收起规则同构。 */
.${PANEL_CLASS}--search.${PANEL_CLASS}--mobile > .layout-tab-bar {
    height: 0;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: height .2s ease, opacity .12s ease, visibility 0s linear .2s;
}
.${PANEL_CLASS}--mobile > .layout-tab-bar > .${PANEL_CLASS}__tab {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 每项一个能整块点中的宽度：图标 + 四个汉字上下，再窄就只能靠精准点字 */
    min-width: 6.5rem;
    padding: 0 10px;
}
/* 页签图标：两端同一份，移动端不再只有文字 */
.${PANEL_CLASS}__tab-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    margin-inline-end: 6px;
    fill: currentColor;
}
/* 桌面端：页签列表 + 内容，左右分栏。宽度、内边距与分隔线照抄内核设置的
   .config__panel > .config__side（分类标签都不长，收窄到 220px）。 */
.${PANEL_CLASS}__side {
    flex: 0 0 auto;
    width: 220px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding: 12px;
    box-sizing: border-box;
    border-right: 1px solid var(--b3-border-color);
    user-select: none;
    /* 搜索时这一栏要收起来：宽度、内边距与透明度一起过渡，内容区跟着平滑变宽。
       不用 display:none —— 那样没有过渡，一开一收是硬跳。
       visibility 在收起时延时到宽度收完才生效（收起后既点不到也 Tab 不到），
       展开时延迟为 0，立刻可见。 */
    transition: width .2s ease, padding .2s ease, opacity .12s ease, border-right-color .2s ease,
        visibility 0s;
}
.${PANEL_CLASS}--search > .${PANEL_CLASS}__side {
    width: 0;
    padding-inline: 0;
    opacity: 0;
    border-right-color: transparent;
    visibility: hidden;
    pointer-events: none;
    transition: width .2s ease, padding .2s ease, opacity .12s ease, border-right-color .2s ease,
        visibility 0s linear .2s;
}
/* 系统里关掉了动效就不要再过渡：宽度 / 高度一步到位。收起方向的那几条也要点名写进来，
   它们的特异性比基础规则高，只关基础规则的话「收起」照样会动。 */
@media (prefers-reduced-motion: reduce) {
    .${PANEL_CLASS}__side,
    .${PANEL_CLASS}--search > .${PANEL_CLASS}__side,
    .${PANEL_CLASS}--mobile > .layout-tab-bar,
    .${PANEL_CLASS}--search.${PANEL_CLASS}--mobile > .layout-tab-bar {
        transition: none;
    }
}
.${PANEL_CLASS}__tabs {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0;
    padding: 0;
    list-style: none;
}
.${PANEL_CLASS}__side .b3-list-item {
    line-height: 32px;
    margin: 8px;
}
.${PANEL_CLASS}__side .b3-list-item__graphic {
    padding: 0 6px 0 4px;
}
/* 搜索框：桌面端在内容区顶部、设置行上方（移动端由 --mobile 那段单独摆放）。
   左侧内边距是「页签内容的 24px + 行自己的 24px」，输入框左端与行标题（.config-item__main
   的文字起点）对齐，而不是跟行间分割线的左端对齐；上下留白就靠这一圈内边距，
   不加边框也不做成卡片。 */
.${PANEL_CLASS}__search {
    flex: 0 0 auto;
    padding: 16px 24px 8px 48px;
}
/* 输入框与它里面那颗清空按钮算一格：按钮绝对定位在输入框内部右侧 */
.${PANEL_CLASS}__search-field {
    position: relative;
}
/* 桌面端不铺满整行：搜索框是一条输入框，不是标题栏。移动端仍然整行撑满（屏幕本来就窄）。 */
.${PANEL_CLASS}:not(.${PANEL_CLASS}--mobile) .${PANEL_CLASS}__search-field {
    max-width: 22rem;
}
.${PANEL_CLASS}__search-field .b3-text-field {
    width: 100%;
    box-sizing: border-box;
    /* 右侧给清空按钮让位，长文案不会压到图标上 */
    padding-inline-end: 28px;
}
/* 一键清空：输入框内右侧的纯图标按钮（思源内置 iconClose）。有内容才出现，
   颜色按内核那套次要图标取 --b3-theme-on-surface-light，悬停时加深。 */
.${PANEL_CLASS}__search-clear {
    position: absolute;
    top: 50%;
    inset-inline-end: 5px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background-color: transparent;
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
}
.${PANEL_CLASS}__search-clear:hover,
.${PANEL_CLASS}__search-clear:focus-visible {
    color: var(--b3-theme-on-background);
    background-color: var(--b3-list-hover);
}
.${PANEL_CLASS}__search-clear svg {
    width: 11px;
    height: 11px;
    fill: currentColor;
}
/* 移动端是手指在点：按钮与图标都给大一档，输入框右侧同时多让出一点 */
.${PANEL_CLASS}--mobile .${PANEL_CLASS}__search-clear {
    width: 22px;
    height: 22px;
}
.${PANEL_CLASS}--mobile .${PANEL_CLASS}__search-clear svg {
    width: 13px;
    height: 13px;
}
.${PANEL_CLASS}--mobile .${PANEL_CLASS}__search-field .b3-text-field {
    padding-inline-end: 32px;
}
/* 移动端：搜索框整行撑满，落在面板标题下方、页签栏上方；不吸顶（吸顶的只有页签栏）。 */
.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__search {
    padding: 8px 8px 0;
}
/* 页签内容：最上面一行是搜索框，下面一叠页签。只有当前页留在文档流里（其余是 fn__none），
   滚动各自独立 —— 弹窗自己的 .b3-dialog__content 不再滚动，搜索框也不会被内容顶走。 */
.${PANEL_CLASS}__views {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
.${PANEL_CLASS}__panes {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
/* 顶部内边距比两侧小：上面就是搜索框，再空 24px 会把首行推得太远 */
.${PANEL_CLASS}__view {
    position: absolute;
    inset: 0;
    overflow: auto;
    box-sizing: border-box;
    padding: 4px 24px 24px;
}
/* 移动端：整块面板按自然高度排版，滚动交给宿主的内容区（抽屉高度就是量它量出来的）。
   所以这里把「每页绝对定位 + 各自滚动」拆掉，改成正常文档流；页签栏的吸顶由上面那条规则负责。
   移动端的搜索框在面板标题下方（不在这个容器里），这里只是不再占一行。 */
.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__views {
    position: static;
    flex: 0 0 auto;
    overflow: visible;
}
.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes {
    position: static;
    flex: 0 0 auto;
    overflow: visible;
}
.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes > .${PANEL_CLASS}__view {
    position: static;
    overflow: visible;
    padding: 8px;
}
/* 设置行不要卡片底色与大圆角 */
.${PANEL_CLASS} .config-items {
    background-color: transparent;
    border-radius: 0;
}
/* 搜索结果视图 -----------------------------------------------------------
   输入有效关键词后，所有命中的分类按声明顺序拼成一列：桌面端由 views 自己滚（每页不再
   各自占满整块、也不再分别滚动），移动端本来就是正常文档流、交给宿主的内容区滚。
   原来的分类导航（左侧页签列表 / 顶部页签栏）由 JS 收起，搜索框留在原处。
   页签内容的内边距在这里归零：行有自己的内边距，再叠一层只会让结果左右缩进一大截。 */
.${PANEL_CLASS}--search > .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes {
    overflow-y: auto;
    overflow-x: hidden;
}
.${PANEL_CLASS}--search > .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes > .${PANEL_CLASS}__view {
    position: static;
    overflow: visible;
    /* 横向内边距与普通状态一致：结果列的分割线、文案不会因为搜索而左右跳一下 */
    padding: 0 24px;
}
.${PANEL_CLASS}--search.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes {
    overflow: visible;
}
.${PANEL_CLASS}--search.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes >
.${PANEL_CLASS}__view {
    position: static;
    overflow: visible;
    padding: 0 8px;
}
/* 分组标题：搜索时分类名作为这一组结果的小标题，平时收起（普通状态下分类由页签表达）。
   横向内边距与行文案的起点对齐（页签内容 24px + 行自己的 24px 里只算这一层，
   所以这里写 24px 就落在行标题那条竖线上；窄屏跟着 10px 走，见媒体查询）。 */
.${PANEL_CLASS}__group {
    padding: 12px 24px 4px;
    color: var(--b3-theme-on-surface);
    opacity: .7;
    font-size: .85em;
    line-height: 1.6;
    user-select: none;
}
/* 命中文字：只换底色，字号与字重都不动 —— 高亮不能改变行本身的样子。 */
.${PANEL_CLASS}__hit {
    background-color: var(--b3-theme-primary-lightest);
    color: inherit;
    border-radius: 2px;
}
/* 子设置行缩进 -----------------------------------------------------------
   功能名那一行（__sub）保持原样，它下面的参数行、说明块、动作行统一缩进一小格，
   「哪个设置属于哪个功能」一眼就看得出来。缩进加在整行上而不是只挪文案：
   移动端控件会折到第二行，整行一起缩进才对齐；行间的分割线仍由内核画满整行。
   基数跟着行自己的内边距走 —— 桌面端内核给 .b3-label 的是 24px，
   窄屏下面板把行压到 10px（见下面的媒体查询），所以两边各写一条。 */
.${PANEL_CLASS} .config-items > .${CHILD_CLASS} {
    /* 引导线的定位基准：竖线与横折都相对这一行摆 */
    position: relative;
    padding-inline-start: 40px;
}
/* 层级引导线 -------------------------------------------------------------
   缩进之后「这些行属于上面那个功能」还差一口气，再补一条树形引导线：
   一条竖线把同一功能的所有子行串起来，每一行在自己的垂直中线处伸出一小段横折指向文案。
   线画在子行自己的伪元素上，所以它天然从功能名那一行的下沿开始，
   不需要为它加任何分组容器（页签里的行必须保持平铺，多一层就多一层层级）。
   最后一个子行带 LAST_CHILD_CLASS（由 markLastChildRow 在拼行时打上），
   竖线只画到折角处、收成 └，否则它会一直画到行的下沿，看着像下面还有内容没显示完。
   颜色取 --b3-border-color，与行间分割线同色，深浅主题都跟着思源走。 */
.${PANEL_CLASS} .config-items > .${CHILD_CLASS}::before,
.${PANEL_CLASS} .config-items > .${CHILD_CLASS}::after {
    content: "";
    position: absolute;
    pointer-events: none;
    background-color: var(--b3-border-color);
}
/* 竖线：从行顶画到行底，与上下相邻的子行接成一条连续的线 */
.${PANEL_CLASS} .config-items > .${CHILD_CLASS}::before {
    inset-inline-start: 20px;
    top: 0;
    bottom: 0;
    width: 1px;
}
/* 横折：从竖线伸到文案左侧，留一小段空隙，不贴字 */
.${PANEL_CLASS} .config-items > .${CHILD_CLASS}::after {
    inset-inline-start: 20px;
    top: 50%;
    width: 10px;
    height: 1px;
}
/* 最后一行：竖线到折角为止 */
.${PANEL_CLASS} .config-items > .${CHILD_CLASS}--last::before {
    bottom: 50%;
}
/* 面板里的文案统一常规字重：功能名（父项）与它下面的子设置项、动作行都不加粗。
   「哪个设置属于哪个功能」由子行的缩进与左侧那条层级引导线表达，不再靠字重——
   加粗功能名会把两侧的视觉重心都拉到标题上，参数行被压成一片灰。
   因此这里不给任何一类行单独调字重；说明（.b3-label__text）只换颜色，与内核一致。 */
.${PANEL_CLASS} .config-item__main .b3-label__text {
    color: var(--b3-theme-on-surface);
}
.${PANEL_CLASS} .config-item:last-child,
.${PANEL_CLASS} .config-item--last-visible {
    border-bottom: 0;
}
.${PANEL_CLASS} .${PANEL_CLASS}__empty {
    flex: 1 1 auto;
    min-width: 0;
    padding: 18px 12px;
    text-align: center;
    color: var(--b3-theme-on-surface);
    opacity: .7;
}
.${PANEL_CLASS} .${PANEL_CLASS}__note .b3-label__text {
    margin-top: 0;
}
.${PANEL_CLASS} .${PANEL_CLASS}__note .b3-label__text + .b3-label__text {
    margin-top: 6px;
}
/* 说明块的动作按钮：与面板里其它行同一套位置 —— 文字让出右侧，按钮竖着叠在右边，
   每颗 200px、整列上下居中（「导出配置」那些按钮正是这个位置和宽度）。
   文字因此会被压窄一点，这是对的：一段说明配一组入口，本来就该是「左文右按钮」。
   窄屏放不下，由下面的媒体查询改回「文字在上、按钮整行在下」。 */
.${PANEL_CLASS} .${PANEL_CLASS}__note {
    display: flex;
    align-items: center;
    gap: 8px;
}
.${PANEL_CLASS} .${PANEL_CLASS}__note-body {
    flex: 1 1 0;
    min-width: 0;
}
.${PANEL_CLASS} .${PANEL_CLASS}__note-actions {
    display: flex;
    flex: 0 0 200px;
    width: 200px;
    flex-direction: column;
    gap: 8px;
}
.${PANEL_CLASS} .${PANEL_CLASS}__note-actions .b3-button {
    width: 100%;
    box-sizing: border-box;
}
.${PANEL_CLASS} .${PANEL_CLASS}__note a {
    color: var(--b3-theme-primary);
    word-break: break-all;
}

/* 弹窗容器宽度 -----------------------------------------------------------
   真正的宽度由 setting-dialog.ts 的 applyPanelWidth() 量完视口写成行内样式，
   因为 CSS 这条路已经证实不可靠：Dialog 把宽度写成容器上的行内样式
   （桌面 768px、移动端 92vw），而内核给 .b3-dialog__container 设了
   flex-shrink: 0 —— 行内宽度 + 不收缩，视口一旦更窄容器就整块溢出屏幕。
   这里只留一条兜底：CSS 没生效时也别让它宽过视口。
   必须 !important —— 内核自己也用同优先级的 max-width 声明这一条。 */
.some-settings-dialog.b3-dialog__container {
    max-width: 100% !important;
    min-width: 0;
}

/* 单位标签：内核给 .b3-dialog__content 设了 word-break: break-all，
   容器一旦容不下，连 "ms" 这种两个字母的单位都会被从中间断成两行。
   nowrap 才是止血点（keep-all 只约束 CJK，对 "ms" 无效）。 */
.${PANEL_CLASS} .config-item__unit {
    flex: 0 0 auto;
    white-space: nowrap;
}

/* 窄面板适配 -------------------------------------------------------------
   弹窗宽度由用户拖拽决定，思源给 .config-item__main 的 flex:1 在窄宽度下
   会把文案挤成一列单字。这里给文案一个最小宽度，空间不够就让整行折成
   上下两段（文案在上、控件在下并撑满宽度），而不是把字竖向排开。 */
.${PANEL_CLASS} .config-item,
.${PANEL_CLASS} .config-item__main {
    min-width: 0;
}
.${PANEL_CLASS} label.config-item > .config-item__main:first-child,
.${PANEL_CLASS} div.config-item > .config-item__main:first-child {
    flex: 1 1 12rem;
}
.${PANEL_CLASS} .config-item .fn__size200,
.${PANEL_CLASS} .config-item .config-item__number {
    max-width: 100%;
}
.${PANEL_CLASS} .config-item .b3-select,
.${PANEL_CLASS} .config-item .b3-text-field {
    min-width: 0;
}
.${PANEL_CLASS} .b3-switch {
    margin-inline-start: auto;
}

/* 移动端 / 窄窗口 ---------------------------------------------------------
   断点与内核一致（内核在 750px 以下把 .config-item 折成上下两段、输入框撑满整行）。
   关键是行内边距：内核给 .b3-label 的 16px 24px 在手机上会吃掉近一半屏宽，
   上下各 16px 还会把每行之间撑出 32px 的空隙——这正是"边距特别大"的主因。
   选择器比内核的 .config__tab-container .b3-label 多一级，
   不论样式表加载顺序如何都稳定生效。作用域用容器上的 some-settings-dialog 类限定。 */
@media (max-width: 750px) {
    .some-settings-dialog .b3-dialog__action {
        padding: 7px 8px;
    }
    /* 页签内容自己也收到 8px：弹窗内容区已经不再留内边距（见 applyDesktopLayout） */
    .b3-dialog__body .${PANEL_CLASS}__view {
        padding: 8px;
    }
    /* 桌面端把窗口缩到 750px 以下时，侧栏收成一列只有图标的页签（内核设置页同款做法），
       否则 220px 的侧栏会把内容区挤没。 */
    .b3-dialog__body .${PANEL_CLASS}__side {
        width: auto;
        padding: 12px 4px;
    }
    .b3-dialog__body .${PANEL_CLASS}__side .b3-list-item {
        width: 24px;
        margin: 8px auto;
    }
    .b3-dialog__body .${PANEL_CLASS}__side .b3-list-item__text {
        display: none;
    }
    /* 搜索框的横向内边距跟着窄屏走：左侧同样对齐到行标题（页签内容 8px + 行 10px） */
    .b3-dialog__body .${PANEL_CLASS} .${PANEL_CLASS}__search {
        padding: 8px 10px 6px 18px;
    }
    /* 移动端例外：它的搜索框在页签栏上方，左端要对的是「页签栏第一项的左边」和行的分割线
       （页签栏自己 4px + 项 4px = 8px），不是行标题的文字起点。两端都取 8px，
       输入框正好铺满分割线的宽度。选择器多带 --mobile 一级，才压得过上面那条窄屏规则。 */
    .b3-dialog__body .${PANEL_CLASS}.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__search {
        padding: 8px 8px 6px;
    }
    /* 搜索结果的分组标题：窄屏下留白与横向内边距一起跟着 10px 走 */
    .b3-dialog__body .${PANEL_CLASS} .${PANEL_CLASS}__group {
        padding: 8px 10px 4px;
    }
    /* 窄屏下结果列的横向内边距也收到 10px，与普通状态的行一致 */
    .b3-dialog__body .${PANEL_CLASS}.${PANEL_CLASS}--search > .${PANEL_CLASS}__views >
    .${PANEL_CLASS}__panes > .${PANEL_CLASS}__view {
        padding: 0 10px;
    }
    /* 移动端同样按 8px 走：进来搜（结果列）和没搜（普通行）时，行的分割线停在同一处，
       否则一进搜索整列会横向挪 2px，搜索框也跟着对不齐。 */
    .b3-dialog__body .${PANEL_CLASS}.${PANEL_CLASS}--search.${PANEL_CLASS}--mobile >
    .${PANEL_CLASS}__views > .${PANEL_CLASS}__panes > .${PANEL_CLASS}__view {
        padding: 0 8px;
    }
    .b3-dialog__body .${PANEL_CLASS} .b3-label.config-item,
    .b3-dialog__body .${PANEL_CLASS} .config-item {
        padding: 8px 10px;
    }
    /* 子行缩进跟着窄屏这 10px 走；选择器多带 .config-item 一级，才压得过上面那条简写 */
    .b3-dialog__body .${PANEL_CLASS} .b3-label.config-item.${CHILD_CLASS} {
        padding-inline-start: 26px;
    }
    /* 引导线跟着窄屏这 26px 一起收：竖线挪到 12px，横折到 20px 为止，
       与文案之间同样留 6px。缩进改了这里不改，线会压到文字上。 */
    .b3-dialog__body .${PANEL_CLASS} .config-items > .${CHILD_CLASS}::before,
    .b3-dialog__body .${PANEL_CLASS} .config-items > .${CHILD_CLASS}::after {
        inset-inline-start: 12px;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-items > .${CHILD_CLASS}::after {
        width: 8px;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item__main {
        flex: 1 1 100%;
        margin: 0;
    }
    /* 功能行的右边只有一个开关，把标题也撑满整行只会把开关挤到第二行去，
       所以这一行保持左右布局，让标题自己让出空间。
       flex-basis 必须取 0 而不是 auto：内核给 .config-item 开了 flex-wrap，
       折行判定发生在收缩之前，用的是「基准尺寸之和」——基准取内容宽度时，
       标题一长（或右边是下拉而不是开关时）就会把控件整个顶到第二行去。
       取 0 之后先是同一行，再由 grow 把剩下的宽度分给标题。
       选择器必须多带一个 .config-item：上面那条 div.config-item > ...:first-child
       的 :first-child 也算一份特异性，不带就跟它打平、按先后顺序输掉。 */
    .b3-dialog__body .${PANEL_CLASS} .config-item.${PANEL_CLASS}__sub > .config-item__main {
        flex: 1 1 0;
    }
    /* 拿 selector 当开关的功能，那个下拉也在功能行里，同样不许被上面的
       「控件撑满整行」规则挤到第二行去：让它在标题让出空间之后占满剩余宽度。
       选择器多一级（带 __sub），不论样式表顺序如何都稳定生效。 */
    .b3-dialog__body .${PANEL_CLASS} .config-item.${PANEL_CLASS}__sub > .b3-select {
        flex: 0 1 auto;
        width: auto;
        min-width: 7rem;
        max-width: 55%;
        margin-top: 0;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item > .fn__space {
        display: none;
    }
    /* 参数行上的控件撑满整行；功能行（__sub）不算参数行，它右边的下拉要留在
       功能名那一行，所以这里把 __sub 排除掉，交给下面那条规则处理。
       少了这个排除，同样特异性的「撑满整行」会按后来的顺序压掉那条规则。 */
    .b3-dialog__body .${PANEL_CLASS} .config-item:not(.${PANEL_CLASS}__sub) > .fn__size200:not(.b3-switch),
    .b3-dialog__body .${PANEL_CLASS} .config-item > .b3-text-field,
    .b3-dialog__body .${PANEL_CLASS} .config-item > .b3-select {
        width: 100%;
        max-width: 100%;
        margin-top: 6px;
    }
    /* 窄屏放不下「左文右按钮」：说明块改回上下布局，按钮撑满整行 ——
       200px 在手机上只剩半屏，两颗各占一半更容易误点 */
    .b3-dialog__body .${PANEL_CLASS} .${PANEL_CLASS}__note {
        display: block;
    }
    .b3-dialog__body .${PANEL_CLASS} .${PANEL_CLASS}__note-actions {
        width: auto;
        margin-top: 12px;
    }
    .b3-dialog__body .${PANEL_CLASS} .${PANEL_CLASS}__note-actions .b3-button {
        width: 100%;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item__number {
        flex-wrap: nowrap;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item__number > .b3-text-field {
        width: auto;
        margin-top: 0;
    }
}
`;

const PANEL_CSS_ID = `${PANEL_CLASS}-local-css`;

/**
 * 在当前文档里确保设置面板的局部样式**是最新的一份**。
 *
 * 这里必须每次都重写 `textContent`，不能在元素已存在时直接返回：
 * 关掉插件再打开、或者「重载插件」都不会重载页面，`<style>` 元素还留在 `<head>` 里，
 * 于是新代码会配上一份**旧样式表**——现象就是「功能行的开关变了（JS 生效），
 * 但字重、间距还是改动前那一套（CSS 没生效）」，而且怎么重载插件都不好，
 * 只有整页刷新才恢复正常。样式内容由本文件生成，重写一次的开销可以忽略。
 */
export const ensurePanelCss = (): void => {
    let element = document.getElementById(PANEL_CSS_ID) as HTMLStyleElement | null;
    if (!element) {
        element = document.createElement("style");
        element.id = PANEL_CSS_ID;
        document.head.append(element);
    }
    if (element.textContent !== PANEL_CSS) {
        element.textContent = PANEL_CSS;
    }
};
