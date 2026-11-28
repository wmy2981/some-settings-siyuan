[English](api.md) | **简体中文** | [繁體中文](api.zh-TW.md) | [日本語](api.ja.md) | [Türkçe](api.tr.md) | [Português](api.pt-BR.md)

# 外部插件控制 API

当其他思源插件与本插件的某个功能存在兼容性冲突（或需要协同启用某项能力）时，可以通过本插件实例
公开的 `api` 属性开启或关闭对应功能的持久化配置（`feature-<id>` 配置文件，**不是** `.patch.yml`
声明补丁），并可选「接管锁定」。

## 获取 API 与加载时序

思源中各插件是并发加载的，你的插件可能在 `some-settings-siyuan` 之前启动，也可能在运行过程中遇到
本插件热重载。推荐按下面的方式同时处理「已加载」与「后加载 / 热重载」两种情况：

```ts
import type {Plugin} from "siyuan";

const TARGET = "some-settings-siyuan";
const READY_EVENT = "some-settings-siyuan:ready";
const UNLOAD_EVENT = "some-settings-siyuan:unload";

interface SomeSettingsApi {
    readonly version: number;
    readonly pluginName: string;
    ready(): Promise<void>;
    setFeature(request: {
        caller: string | {name: string; displayName?: string;};
        featureId: string;
        enabled: boolean | string;
        takeover?: boolean;
        reason?: string | Partial<Record<string, string>>;
    }): Promise<unknown>;
    disableFeature(
        caller: string | {name: string; displayName?: string;},
        featureId: string,
        options?: {takeover?: boolean; reason?: string | Partial<Record<string, string>>;},
    ): Promise<unknown>;
    enableFeature(
        caller: string | {name: string; displayName?: string;},
        featureId: string,
        options?: {value?: string; takeover?: boolean; reason?: string | Partial<Record<string, string>>;},
    ): Promise<unknown>;
    release(caller: string | {name: string; displayName?: string;}, featureId: string): {
        released: number;
        featureIds: string[];
    };
    releaseAll(caller: string | {name: string; displayName?: string;}): {
        released: number;
        featureIds: string[];
    };
    getFeatureState(featureId: string): Promise<unknown>;
    listControllableFeatures(): Promise<unknown[]>;
}

const getSomeSettingsApi = (plugin: Plugin): SomeSettingsApi | undefined => {
    const target = plugin.app.plugins.find((item) => item.name === TARGET) as
        | (Plugin & {api?: SomeSettingsApi;})
        | undefined;
    return target?.api;
};
```

完整接入示例（含热重载与卸载释放）：

```ts
export default class MyPlugin extends Plugin {
    private onReady = (event: Event) => {
        const detail = (event as CustomEvent<{api: SomeSettingsApi;}>).detail;
        void this.applyCompatibility(detail.api);
    };

    onload() {
        window.addEventListener("some-settings-siyuan:ready", this.onReady);
        // 即使 some-settings-siyuan 正在异步 onload 中，plugin.api 也已存在，
        // 异步方法内部会自动等待初始化完成。
        const api = getSomeSettingsApi(this);
        if (api) {
            void this.applyCompatibility(api);
        }
    }

    private async applyCompatibility(api: SomeSettingsApi) {
        await api.disableFeature(this, "modal-blur", {
            takeover: true,
            reason: {
                "zh-CN": "与本插件自定义弹窗样式冲突",
                "zh-TW": "與此外掛自訂彈窗樣式衝突",
                en: "Conflicts with this plugin's custom modal styles",
            },
        });
    }

    onunload() {
        window.removeEventListener("some-settings-siyuan:ready", this.onReady);
        getSomeSettingsApi(this)?.releaseAll(this);
    }
}
```

### 生命周期事件

| 事件名（`window`）            | 触发时机               | `event.detail` 载荷            |
| ----------------------------- | ---------------------- | ------------------------------ |
| `some-settings-siyuan:ready`  | 本插件完成初始化加载后 | `{ pluginName, version, api }` |
| `some-settings-siyuan:unload` | 本插件卸载时           | `{ pluginName, version }`      |

## 两种控制模式

### 1. 接管模式（`takeover: true`）

* 改写目标功能的配置文件并立即生效（挂载或卸载功能）；
* 设置页中该功能的标题、说明与黄色提示仍保持清晰可读，但该功能下的**所有操作控件均禁用变灰、不可编辑**；
* 设置页在该功能的最后一行子行常显黄色提示（无论原值是否变化）；
* **接管状态仅在本次运行有效（内存态）**：你的插件应在每次启动时声明接管，并在 `onunload()` 中调用
  `release()` / `releaseAll()`；若你的插件被停用、卸载或重启后不再调用，本插件会自动解锁控件，
  防止造成永久锁死；
* **解除接管后保留已修改的配置值**，不会自动回滚接管前的原值，由用户按需自行改回。

### 2. 非接管模式（`takeover: false`，默认）

* 改写目标功能的配置文件并立即生效，**不锁定控件**；
* **仅在实际改变了当前配置值时**，在设置页该功能的最后一行子行显示黄色提示；若原值已经与目标值一致，
  不产生黄字打扰用户；
* 黄色提示会持久化保存在插件私有存储的 `external-notices` 文件中（不混入 `feature-*` 配置文件，
  也不污染配置导出），跨重启保留；
* 当用户手动编辑该功能的任意设置，或执行「清除本插件配置」「导入配置」后，黄色提示自动取消。

## 方法说明

### `ready(): Promise<void>`

等待本插件完成初始化（加载补丁、配置与持久化提示）。所有异步 API 内部都会先等待它，通常无需手动调用。

### `setFeature(request): Promise<ExternalControlResult>`

请求参数：

| 字段        | 类型                                               | 必填 | 说明                                                                             |
| ----------- | -------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `caller`    | `string \| { name: string; displayName?: string }` | 是   | 调用方插件名，或直接传入思源 `Plugin` 实例（优先实时取宿主插件的 `displayName`） |
| `featureId` | `string`                                           | 是   | 目标功能 id（与 `src/features/<id>` 目录名一致，如 `"modal-blur"`）              |
| `enabled`   | `boolean \| string`                                | 是   | 布尔开关功能传 `true` / `false`；下拉型开关传 `false`（关闭）或合法选项值字符串  |
| `takeover`  | `boolean`                                          | 否   | 是否接管锁定，默认 `false`                                                       |
| `reason`    | `string \| Partial<Record<string, string>>`        | 否   | 可选补充原因，附在本插件内置多语言提示后；支持字符串或按界面语言映射的对象       |

成功返回：

```ts
{
    ok: true,
    featureId: string,
    key: string,             // 实际修改的主控字段名（如 "enabled" / "mode" / "scope"）
    value: boolean | string, // 实际生效的值
    changed: boolean,        // 本次调用是否改变了磁盘配置
    takeover: boolean,       // 本次调用后是否持有接管锁
    release: () => void,     // 释放本次接管的句柄（非接管调用时为空操作；幂等）
}
```

失败返回：

```ts
{
    ok: false,
    featureId: string,
    code:
        | "invalid-caller"  // caller 非法或为空
        | "invalid-feature" // 未找到该功能 id
        | "protected"       // 目标属于受保护的「插件自身」分类
        | "unavailable"     // 当前平台、思源版本或补丁声明下该功能不可用
        | "no-switch"       // 该功能没有可控制的开关（纯动作/说明项）
        | "invalid-value"   // 值类型不对或不在下拉合法选项中
        | "readonly"        // 思源处于只读或发布模式
        | "conflict"        // 与其他插件的接管冲突
        | "write-failed"    // 写盘或读回校验失败
        | "disposed",       // 本插件已卸载
    message: string,
    holders?: string[],     // code 为 "conflict" 时，当前持有接管的插件名列表
}
```

### `disableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: false, ...options })` 的便捷封装，同时适用于布尔开关与下拉型开关功能。

### `enableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: options?.value ?? true, ...options })` 的便捷封装。对于有多个开启档位的下拉型开关（如 `inline-code-copy`、`outline-level-filter`、`exit-confirm`），请通过 `options.value` 明确指定目标选项值。

### `release(caller, featureId)` 与 `releaseAll(caller)`

释放指定调用方在单个功能或全部功能上持有的接管锁，幂等，返回 `{ released: number, featureIds: string[] }`。

### `getFeatureState(featureId)` 与 `listControllableFeatures()`

只读查询单个功能或全部可控制功能的状态，返回是否可用、是否可控、主控字段元信息（含下拉选项与关闭值）、
当前配置值、运行开关态、当前接管列表与非接管提示信息。

## 边界与冲突规则

1. **受保护范围**：「插件自身」分类（如 `log-output`、`show-unavailable-settings`、`settings-search`）
   以及无开关功能不允许被外部控制，调用会返回 `protected` / `no-switch`。
2. **不可用功能**：在当前端或当前思源版本下不可用、或被开发者/用户补丁禁用的功能不写盘，返回 `unavailable`。
3. **多插件冲突（兼容共存 + 冲突拒绝）**：
   * 多个插件以**相同目标值**接管同一功能时共同持有接管，设置页逐行展示所有接管方，全部释放后才解锁；
   * 已有接管时，其他插件发起的非接管调用或**不同目标值**的接管调用直接返回 `conflict`（先来先得）。
4. **卸载兜底**：若外部插件停用或卸载时忘记调用 `releaseAll()`，本插件会在打开设置页或后续 API 校验时
   检测到对方已不在 `app.plugins` 中并自动清理其接管。
5. **实时同步**：设置面板打开期间发生接管、释放或配置变更时，对应功能的控件值、禁用态与黄色提示行会原地实时更新。
6. **多窗口与独立设置窗口**：桌面端打开多个子窗口或「独立窗口打开设置界面」时，每个窗口拥有独立的插件实例；请仅在主窗口调用控制 API，并通过监听 `some-settings-siyuan:ready` 在同步或跨窗口重载后重新声明接管。
