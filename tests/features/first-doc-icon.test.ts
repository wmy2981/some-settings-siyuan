/**
 * 固定首次添加的文档图标。
 *
 * 三条关键行为，全部来自源码：
 * 1. 在**捕获阶段**拦下「添加图标」按钮的点击（内核的处理器在冒泡阶段，抓不到就白做），
 *    并且必须把这次点击彻底吞掉，否则内核照样会走它自己那条路；
 * 2. 写入的是**码点十六进制串**（📄 → `1f4c4`），不是字符本身 —— 写字符会让文件树分支走错；
 * 3. 文档 id 只能从 `getAllEditor()` 的 `protyle.protyle` 上取，`.protyle-wysiwyg` 上没有。
 *
 * 测试替身的限制：`getAllEditor()` 在共享 mock 里恒为 `[]`，这里用 `vi.mock` 把**这一个**导出
 * 换成可控的编辑器列表（不改 tests/mocks/）；`fetchPost` 仍走共享 mock，需要在用例里手动取出
 * 第三个参数这个回调并触发它 —— 宿主的回调语义就是「请求返回后调用」，替身默认不会替我们调用。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/first-doc-icon";
import {mountFirstDocIcon} from "../../src/features/first-doc-icon/icon";
import {
    mountFeature,
    noopLogger,
} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** 可控的「已打开的编辑器」列表；形状照 `Protyle` 外壳 + 内层 `IProtyle`。 */
const editorState = vi.hoisted(() => ({editors: [] as unknown[]}));

vi.mock("siyuan", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getAllEditor: () => editorState.editors,
    };
});

interface IconResponse {
    code: number;
    msg?: string;
}

interface BackgroundOptions {
    /** `data-node-id`；传 null 表示标题区上没有文档 id。 */
    rootId?: string | null;
    /** 图标容器是不是「还没加过图标」的隐藏态。 */
    iconHidden?: boolean;
    /** 是否渲染 `.protyle-background__icon` 容器。 */
    withIconElement?: boolean;
}

/** 照宿主的标题区结构造一份 DOM：`.protyle-background` + 图标容器 + 「添加图标」按钮。 */
const buildBackground = (options: BackgroundOptions = {}) => {
    const background = document.createElement("div");
    background.className = "protyle-background";
    if (options.rootId !== null) {
        background.setAttribute("data-node-id", options.rootId ?? "root-1");
    }
    if (options.withIconElement !== false) {
        const icon = document.createElement("div");
        icon.className = "protyle-background__icon";
        if (options.iconHidden !== false) {
            icon.classList.add("fn__none");
        }
        background.append(icon);
    }
    const button = document.createElement("button");
    button.setAttribute("data-type", "icon");
    button.innerHTML = "<span>+</span>";
    background.append(button);
    document.body.append(background);
    return {
        background,
        button,
        icon: background.querySelector<HTMLElement>(".protyle-background__icon"),
    };
};

/** 文件树 / 大纲里那一行：图标元素是 `.b3-list-item__icon` 与 `.b3-list-item__graphic`。 */
const buildListRow = (rootId: string, emoji = "") => {
    const row = document.createElement("div");
    row.setAttribute("data-node-id", rootId);
    row.innerHTML = `<div class="b3-list-item__icon">${emoji}</div><div class="b3-list-item__graphic"></div>`;
    document.body.append(row);
    return row;
};

/** 取出最近一次 `fetchPost` 的回调并触发它（宿主的替身不会自动回调）。 */
const finishWrite = (response: IconResponse): void => {
    const call = mockState.fetchPost.mock.calls.at(-1);
    const callback = call?.[2] as ((value: IconResponse) => void) | undefined;
    expect(callback).toBeTypeOf("function");
    callback?.(response);
};

const click = (element: Element): boolean =>
    element.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));

describe("固定首次添加的文档图标", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = (config?: Record<string, unknown>) => {
        const harness = mountFeature(definition, config ? {config} : {});
        mounted.push(harness);
        return harness;
    };

    beforeEach(() => {
        editorState.editors = [];
    });

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
        editorState.editors = [];
    });

    it("声明里默认关闭，图标默认是 📄", () => {
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.settings[1]).toMatchObject({kind: "text", key: "emoji", default: "📄"});
        expect(definition.category).toBe("doc-tree");
    });

    it("首次点击：拦下点击、按码点写入配置的 emoji", () => {
        const {button} = buildBackground();
        mount();

        // dispatchEvent 返回 false 表示 defaultPrevented —— 内核那条分支不会再执行
        expect(click(button)).toBe(false);

        expect(mockState.fetchPost).toHaveBeenCalledTimes(1);
        expect(mockState.fetchPost.mock.calls[0][0]).toBe("/api/attr/setBlockAttrs");
        // icon 存的是码点串，直接写字符会让文件树 / 大纲的分支走错
        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({id: "root-1", attrs: {icon: "1f4c4"}});
    });

    it("点击被彻底吞掉：按钮自己的监听收不到，父级只见到随后那次「开面板」的合成点击", () => {
        const {button, background, icon} = buildBackground();
        const onButton = vi.fn();
        const onBackground = vi.fn();
        button.addEventListener("click", onButton);
        background.addEventListener("click", onBackground);
        mount();

        click(button);

        // 捕获阶段 stopPropagation() 之后，连目标元素上的监听也不会跑
        expect(onButton).not.toHaveBeenCalled();
        // 父级唯一收到的那一次，是功能自己派发到图标容器上的（用来打开内核的 emoji 面板）
        expect(onBackground).toHaveBeenCalledTimes(1);
        expect((onBackground.mock.calls[0][0] as MouseEvent).target).toBe(icon);
        expect(mockState.fetchPost).toHaveBeenCalledTimes(1);
    });

    it("多码点 emoji 逐码点转十六进制，用连字符拼接", () => {
        [
            {emoji: "👍🏽", expected: "1f44d-1f3fd"},
            // 变体选择符与零宽连接符也要原样保留，否则内核还原出来的是另一个字形
            {emoji: "🏳️‍🌈", expected: "1f3f3-fe0f-200d-1f308"},
            {emoji: "🚀", expected: "1f680"},
        ].forEach(({emoji, expected}) => {
            const {button} = buildBackground();
            mount({emoji});
            click(button);
            expect(mockState.fetchPost.mock.calls.at(-1)?.[1]).toEqual({id: "root-1", attrs: {icon: expected}});
            mounted.splice(0).forEach((harness) => harness.dispose());
            document.body.innerHTML = "";
            mockState.fetchPost.mockClear();
        });
    });

    it("emoji 配成空白时回落到默认 📄（说明文案说「留空不写入」，实现是回落默认值）", () => {
        const {button} = buildBackground();
        mount({emoji: "   "});

        click(button);

        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({id: "root-1", attrs: {icon: "1f4c4"}});
    });

    it("写盘成功后立即就地更新文件树 / 大纲的图标，且只动这份文档", () => {
        const {button} = buildBackground();
        const row = buildListRow("root-1");
        const other = buildListRow("root-2", "📁");
        mount();

        click(button);
        finishWrite({code: 0});

        expect(row.querySelector(".b3-list-item__icon")?.textContent).toBe("📄");
        expect(row.querySelector(".b3-list-item__graphic")?.textContent).toBe("📄");
        expect(other.querySelector(".b3-list-item__icon")?.textContent).toBe("📁");
    });

    it("写盘失败只记日志、不改列表图标（界面不能被改成没存住的图标）", () => {
        const {button} = buildBackground();
        const row = buildListRow("root-1");
        const harness = mount();

        click(button);
        finishWrite({code: -1, msg: "denied"});

        expect(row.querySelector(".b3-list-item__icon")?.textContent).toBe("");
        expect(harness.records.logs.at(-1)?.[0]).toContain("failed to write the document icon: denied");
    });

    it("图标已经显示时不拦截：只处理「首次」", () => {
        const {button, icon} = buildBackground({iconHidden: false});
        mount();

        expect(click(button)).toBe(true);
        expect(mockState.fetchPost).not.toHaveBeenCalled();
        expect(button.classList.contains("fn__none")).toBe(false);
        expect(icon?.textContent).toBe("");
    });

    it("没有图标容器、或按钮不在标题区里时不动手", () => {
        const {button} = buildBackground({withIconElement: false});
        mount();
        click(button);
        expect(mockState.fetchPost).not.toHaveBeenCalled();

        mounted.splice(0).forEach((harness) => harness.dispose());
        document.body.innerHTML = "";

        const stray = document.createElement("button");
        stray.setAttribute("data-type", "icon");
        document.body.append(stray);
        mount();
        expect(click(stray)).toBe(true);
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });

    it("只读文档里跟着内核一起不动", () => {
        const {background, button} = buildBackground();
        editorState.editors = [{
            protyle: {element: background, disabled: true, block: {rootID: "root-1"}},
        }];
        mount();

        expect(click(button)).toBe(true);

        expect(mockState.fetchPost).not.toHaveBeenCalled();
        // 只读时连 preventDefault 都不该做：这次点击仍旧交给宿主处理
        expect(button.classList.contains("fn__none")).toBe(false);
    });

    it("文档 id 优先取编辑器外壳里的 rootID，退到标题区的 data-node-id", () => {
        const {background, button} = buildBackground({rootId: "from-dom"});
        editorState.editors = [{
            protyle: {element: background, disabled: false, block: {rootID: "from-editor"}},
        }];
        mount();
        click(button);
        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({id: "from-editor", attrs: {icon: "1f4c4"}});

        mounted.splice(0).forEach((harness) => harness.dispose());
        document.body.innerHTML = "";
        mockState.fetchPost.mockClear();
        editorState.editors = [];

        // 没有编辑器外壳（例如从文件树打开前）时退回标题区自己的 data-node-id
        const fallback = buildBackground({rootId: "from-dom"});
        mount();
        click(fallback.button);
        expect(mockState.fetchPost.mock.calls[0][1]).toEqual({id: "from-dom", attrs: {icon: "1f4c4"}});
    });

    it("拿不到文档 id 时只记日志，不动点击的默认行为", () => {
        const {button} = buildBackground({rootId: null});
        const harness = mount();

        expect(click(button)).toBe(true);

        expect(mockState.fetchPost).not.toHaveBeenCalled();
        expect(harness.records.logs.at(-1)?.[0]).toContain("no document ID available");
    });

    it("写入后图标立刻显形、按钮隐藏，并打开内核自己的 emoji 面板", () => {
        const {button, icon} = buildBackground();
        const openPanel = vi.fn();
        icon?.addEventListener("click", openPanel);
        mount();

        click(button);

        expect(icon?.textContent).toBe("📄");
        expect(icon?.classList.contains("fn__none")).toBe(false);
        expect(button.classList.contains("fn__none")).toBe(true);
        // 走内核图标容器自己的 open-emoji 分支，保留「想换随时能换」
        expect(openPanel).toHaveBeenCalledTimes(1);
        // 这次合成点击不能被当成又一次「首次添加」
        expect(mockState.fetchPost).toHaveBeenCalledTimes(1);
    });

    it("点击目标不是元素（例如 document 自己派发的事件）时直接忽略", () => {
        const {button} = buildBackground();
        mount();

        // 捕获期监听拿到的 target 也可能是 document 这类非 Element
        document.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(mockState.fetchPost).not.toHaveBeenCalled();

        // 正常点击依旧生效，说明这次忽略没有把监听弄坏
        click(button);
        expect(mockState.fetchPost).toHaveBeenCalledTimes(1);
    });

    it("dispose 之后不再拦截点击", () => {
        const {button} = buildBackground();
        const harness = mount();

        harness.dispose();

        expect(click(button)).toBe(true);
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });

    it("挂载只加一个捕获期监听，destroy 后移除", () => {
        const host = {
            config: {emoji: "📄"},
            log: noopLogger,
        } as unknown as Parameters<typeof mountFirstDocIcon>[0];

        const instance = mountFirstDocIcon(host);
        expect(typeof instance?.destroy).toBe("function");
        instance?.destroy();

        const {button} = buildBackground();
        expect(click(button)).toBe(true);
        expect(mockState.fetchPost).not.toHaveBeenCalled();
    });
});
