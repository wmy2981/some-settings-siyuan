/**
 * `siyuan` 模块的测试替身。
 *
 * npm 上的 `siyuan` 只有类型声明，运行时由宿主注入，所以单元测试里必须整块替换。
 * 测试想要改变宿主行为时，改这里导出的 `mockState`（前端类型、内核响应、对话框结构、
 * confirm 的答案），而不是去 mock 被测模块内部的私有状态。
 */
import {vi} from "vitest";

/** 宿主 `confirm()` 的一次调用记录。 */
export interface ConfirmCall {
    title: string;
    text: string;
    /** 调用方点的是「确定」还是「取消」。 */
    accepted: boolean;
}

/** `showMessage()` 的一次调用记录。 */
export interface MessageCall {
    text: string;
    timeout?: number;
    type?: string;
}

/**
 * 全部可驱动的宿主状态。
 *
 * 每个测试开始前由 `tests/setup.ts` 复位，测试里只改自己关心的字段。
 */
export const mockState = {
    /** `getFrontend()` 的返回值：desktop / desktop-window / mobile / browser-mobile。 */
    frontend: "desktop",
    /** `confirm()` 统一按「确定」处理，改成 false 就走取消分支。 */
    confirmAnswer: true,
    confirms: [] as ConfirmCall[],
    messages: [] as MessageCall[],
    /** 宿主 `Setting.open()` 建出来的对话框实例，供断言「面板有没有打开」。 */
    settings: [] as Setting[],
    /** `Setting.open()` 收到的标题，供断言「面板标题用的是哪个名字」。 */
    settingTitles: [] as (string | undefined)[],
    /** 让 `Setting.open()` 抛错，用于验证面板清理状态。 */
    settingOpenError: null as Error | null,
    /** 让 `Setting.open()` 不建对话框（结构异常的宿主版本）。 */
    settingDialogMissing: false,
    /** 让 `Setting.open()` 建一个没有 `.b3-dialog__body` 的对话框。 */
    settingBodyMissing: false,
    /** 让正文区里没有 `.b3-dialog__content` / `.b3-dialog__action`（结构不同的宿主版本）。 */
    settingRegionsMissing: false,
    /** 让 `Setting.open()` 建一个「独立设置窗口」形态的对话框。 */
    settingAsWindow: false,
    /** 让 `showMessage()` 抛错，用于验证「提示本身失败也不影响主流程」。 */
    showMessageError: null as Error | null,
    /** `fetchSyncPost()` 的固定响应；给函数时按入参决定。 */
    fetchSyncPost: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({code: 0, data: []})),
    /** `fetchPost()` 的固定响应。 */
    fetchPost: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({code: 0, data: null})),
};

/**
 * 收掉测试遗留的面板实例。
 *
 * 宿主的 `Setting` 在关闭时才触发 `destroyCallback`，面板的核心清理（定时器、
 * 静默期补写）都在那里；测试直接把实例丢掉，就等于留了一个还在轮询的定时器。
 * `tests/setup.ts` 在每个测试后调用一次，模拟宿主机收掉所有还开着的对话框。
 */
export const closeOpenSettings = (): void => {
    const open = mockState.settings.filter((setting) => setting.dialog !== undefined);
    mockState.settings = [];
    open.forEach((setting) => {
        try {
            setting.close();
        } catch (error) {
            // 测试可能已经把宿主的依赖替身卸掉了；收尾失败不该污染测试结果。
            void error;
        }
    });
};

/** 复位所有宿主状态；`tests/setup.ts` 在每个测试前调用。 */
export const resetMockState = (): void => {
    mockState.frontend = "desktop";
    mockState.confirmAnswer = true;
    mockState.confirms = [];
    mockState.messages = [];
    mockState.settings = [];
    mockState.settingTitles = [];
    mockState.settingOpenError = null;
    mockState.settingDialogMissing = false;
    mockState.settingBodyMissing = false;
    mockState.settingRegionsMissing = false;
    mockState.settingAsWindow = false;
    mockState.showMessageError = null;
    mockState.fetchSyncPost.mockReset();
    mockState.fetchSyncPost.mockResolvedValue({code: 0, data: []});
    mockState.fetchPost.mockReset();
    mockState.fetchPost.mockResolvedValue({code: 0, data: null});
};

/**
 * 造一段与宿主一致的对话框标记。
 *
 * 宿主的 `Dialog.element` 是一个外层 `<div>`，`.b3-dialog` 是它的子元素
 * （`windowDialog.ts` 就是靠 `element.querySelector(".b3-dialog")` 挂窗口类的），
 * 所以这里也分成外层容器与内层 `.b3-dialog`，别把两者合并成一个。
 */
export const dialogMarkup = (
    options: {asWindow?: boolean; withBody?: boolean; withRegions?: boolean;} = {},
): string => {
    const regions = options.withRegions === false ? "" : `<div class="b3-dialog__content"></div>
        <div class="b3-dialog__action fn__none"></div>`;
    const body = options.withBody === false ? "" : `<div class="b3-dialog__body">${regions}</div>`;
    return `<div class="b3-dialog${options.asWindow ? " b3-dialog--window" : ""}">
        <div class="b3-dialog__container">
            <div class="b3-dialog__header"></div>
            ${body}
        </div>
    </div>`;
};

/** 宿主的对话框对象：中心逻辑只用它的 `element`。 */
export class Dialog {
    element: HTMLElement;
    destroyed = false;

    constructor(options: {content?: string;} = {}) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = dialogMarkup();
        this.element = wrapper;
        if (options.content) {
            const content = this.element.querySelector(".b3-dialog__content");
            if (content) {
                content.innerHTML = options.content;
            }
        }
        document.body.append(this.element);
    }

    destroy(): void {
        this.destroyed = true;
        this.element.remove();
    }
}

/** 宿主的 `Setting`：`open()` 建对话框，`close()` 收掉并触发 `destroyCallback`。 */
export class Setting {
    dialog?: Dialog;
    closed = false;
    destroyCallback?: () => void;

    constructor(options: {destroyCallback?: () => void;} = {}) {
        this.destroyCallback = options.destroyCallback;
        mockState.settings.push(this);
    }

    open(title?: string): void {
        mockState.settingTitles.push(title);
        if (mockState.settingOpenError) {
            throw mockState.settingOpenError;
        }
        if (mockState.settingDialogMissing) {
            return;
        }
        const wrapper = document.createElement("div");
        wrapper.innerHTML = dialogMarkup({
            asWindow: mockState.settingAsWindow,
            withBody: !mockState.settingBodyMissing,
            withRegions: !mockState.settingRegionsMissing,
        });
        document.body.append(wrapper);
        this.dialog = {element: wrapper} as unknown as Dialog;
    }

    close(): void {
        this.closed = true;
        this.dialog?.element.remove();
        this.dialog = undefined as unknown as Dialog | undefined;
        this.destroyCallback?.();
    }
}

/** 宿主的菜单对象：只提供核心用到的 `addItem` / `open`。 */
export class Menu {
    items: {label: string; click?: () => void;}[] = [];

    addItem(options: {label: string; click?: () => void;}): void {
        this.items.push(options);
    }

    open(): void {}
}

/** 插件基类：核心只把它当类型用，这里给一个能实例化的最小实现。 */
export class Plugin {
    name = "some-settings-siyuan";
    displayName = "some settings";
    i18n: Record<string, string> = {};
    eventBus = {on: vi.fn(), off: vi.fn(), emit: vi.fn()};
    protyleSlash: unknown[] = [];

    constructor(options: Record<string, unknown> = {}) {
        Object.assign(this, options);
    }

    loadData = vi.fn(async () => "");
    saveData = vi.fn(async () => ({code: 0}));
    removeData = vi.fn(async () => ({code: 0}));
    addTopBar = vi.fn();
    removeTopBar = vi.fn();
    addCommand = vi.fn();
    addIcons = vi.fn();
    addStatusBar = vi.fn();
    addDock = vi.fn();
    removeDock = vi.fn();
    addTab = vi.fn();
}

/** 当前前端；`frontend.ts` 与 `ui.ts` 都从这里取值。 */
export const getFrontend = (): string => mockState.frontend;

/** 宿主的提示条。 */
export const showMessage = (text: string, timeout?: number, type?: string): void => {
    if (mockState.showMessageError) {
        throw mockState.showMessageError;
    }
    mockState.messages.push({text, timeout, type});
};

/** 宿主的确认框；按 `mockState.confirmAnswer` 决定回调哪一个。 */
export const confirm = (title: string, text: string, yes?: () => void, no?: () => void): void => {
    const accepted = mockState.confirmAnswer;
    mockState.confirms.push({title, text, accepted});
    if (accepted) {
        yes?.();
        return;
    }
    no?.();
};

/** 内核同步请求；响应由 `mockState.fetchSyncPost` 决定。 */
export const fetchSyncPost = (...args: unknown[]): Promise<unknown> => mockState.fetchSyncPost(...args);

/** 内核异步请求。 */
export const fetchPost = (...args: unknown[]): Promise<unknown> => mockState.fetchPost(...args);

/** 编辑器列表；核心不碰它，但功能模块在 import 阶段会引用。 */
export const getAllEditor = (): unknown[] => [];

/** 打开页签。 */
export const openTab = vi.fn();

/** 移动端按 id 打开文件。 */
export const openMobileFileById = vi.fn();

/** 平台判断工具；核心不用，功能模块在 import 阶段会引用。 */
export const platformUtils = {
    isDesktop: (): boolean => mockState.frontend === "desktop" || mockState.frontend === "desktop-window",
    isMobile: (): boolean => mockState.frontend === "mobile" || mockState.frontend === "browser-mobile",
    isBrowser: (): boolean => mockState.frontend === "browser-mobile",
};
