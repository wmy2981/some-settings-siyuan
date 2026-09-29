/**
 * 桌面端 F12 开关开发者工具的实现。
 *
 * 思源桌面端**没有**给 F12 留任何入口：主进程的应用菜单里有 `toggledevtools`，
 * 但那条菜单默认是隐藏的，它的快捷键是 Ctrl+Shift+I（macOS 上是 ⌥⌘I），
 * 而且内核的快捷键表里也没有这一项。开发者工具本身是 Electron 的窗口能力，
 * 插件侧唯一能碰到它的路是渲染进程发一次内核自己的 IPC 命令 ——
 * 内核的「帮助 - 关于」菜单与状态栏右键菜单里的「开发者工具」走的正是这一条：
 * `ipcRenderer.send("siyuan-cmd", "toggleDevTools")`。
 *
 * 插件 API 里没有对应的封装（`platformUtils` 只到通知为止），所以这里按插件加载器的
 * 约定拿 `window.require`：加载器给每个插件传的 `require` 除了 `"siyuan"` 之外
 * 一律转发给它，桌面端 `nodeIntegration` 打开时它就是 Node 的 require。
 * 拿不到（浏览器端、移动端）时功能**静默不做事**，只在控制台留一条日志。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 内核处理自定义命令的 IPC 通道（`Constants.SIYUAN_CMD`）。 */
const SIYUAN_CMD = "siyuan-cmd";
/** 切换开发者工具的命令名，与内核状态栏右键菜单用的是同一个。 */
const TOGGLE_DEVTOOLS = "toggleDevTools";

type NodeRequire = (key: string) => unknown;

interface IpcSender {
    send(channel: string, ...args: unknown[]): void;
}

/**
 * 桌面端才有的 `window.require`。插件代码由 webpack 打成 commonjs，
 * 直接写 `require("electron")` 会被打进包里，所以这里从 window 上取。
 */
const nodeRequire = (): NodeRequire | undefined => {
    const candidate = (window as unknown as {require?: unknown;}).require;
    return typeof candidate === "function" ? candidate as NodeRequire : undefined;
};

/** 取内核的 IPC 发送器；不是 Electron 宿主时返回 undefined。 */
const electronIpc = (): IpcSender | undefined => {
    const requireFn = nodeRequire();
    if (!requireFn) {
        return undefined;
    }
    try {
        const electron = requireFn("electron") as {ipcRenderer?: {send?: unknown;};} | undefined;
        const ipcRenderer = electron?.ipcRenderer;
        if (!ipcRenderer || typeof ipcRenderer.send !== "function") {
            return undefined;
        }
        return {send: (ipcRenderer.send as IpcSender["send"]).bind(ipcRenderer)};
    } catch {
        return undefined;
    }
};

export const mountDevtoolsHotkey = (host: FeatureHost): FeatureInstance => {
    const ipc = electronIpc();
    if (!ipc) {
        // 浏览器里 F12 本来就是浏览器自己的开发者工具，这里不需要也不该插手
        host.log("the host is not the desktop app, F12 is left to the browser");
        return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "F12" && event.code !== "F12") {
            return;
        }
        // 按住不放会不停重复，那样工具窗口会被反复开关
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            return;
        }
        event.preventDefault();
        ipc.send(SIYUAN_CMD, TOGGLE_DEVTOOLS);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return {
        destroy: () => {
            document.removeEventListener("keydown", onKeyDown, true);
        },
    };
};
