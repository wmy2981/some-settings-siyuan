[English](api.md) | [简体中文](api.zh-CN.md) | **繁體中文** | [日本語](api.ja.md) | [Türkçe](api.tr.md) | [Português](api.pt-BR.md)

# 外部外掛控制 API

當其他思源外掛與此外掛的某個功能存在相容性衝突（或需要協同啟用某項能力）時，可以透過此外掛實例公開的
`api` 屬性開啟或關閉對應功能的持久化設定（`feature-<id>` 設定檔，**不是** `.patch.yml` 宣告補丁），
並可選擇「接管鎖定」。

## 取得 API 與載入順序

思源中各外掛是並發載入的，你的外掛可能在 `some-settings-siyuan` 之前啟動，也可能在執行過程中遇到
此外掛熱重載。建議按以下方式同時處理「已載入」與「後載入 / 熱重載」兩種情況：

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

完整接入範例（含熱重載與卸載釋放）：

```ts
export default class MyPlugin extends Plugin {
    private onReady = (event: Event) => {
        const detail = (event as CustomEvent<{api: SomeSettingsApi;}>).detail;
        void this.applyCompatibility(detail.api);
    };

    onload() {
        window.addEventListener("some-settings-siyuan:ready", this.onReady);
        // 即使 some-settings-siyuan 正在非同步 onload 中，plugin.api 也已存在，
        // 非同步方法內部會自動等待初始化完成。
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

### 生命週期事件

| 事件名（`window`）            | 觸發時機               | `event.detail` 內容            |
| ----------------------------- | ---------------------- | ------------------------------ |
| `some-settings-siyuan:ready`  | 此外掛完成初始化載入後 | `{ pluginName, version, api }` |
| `some-settings-siyuan:unload` | 此外掛卸載時           | `{ pluginName, version }`      |

## 兩種控制模式

### 1. 接管模式（`takeover: true`）

* 改寫目標功能的設定檔並立即生效（掛載或卸載功能）；
* 設定頁中該功能的標題、說明與黃色提示仍保持清晰可讀，但該功能下的**所有操作控制項均停用變灰、不可編輯**；
* 設定頁在該功能的最後一行子行常駐顯示黃色提示（不論原值是否變化）；
* **接管狀態僅在本次執行有效（記憶體態）**：你的外掛應在每次啟動時宣告接管，並在 `onunload()` 中呼叫
  `release()` / `releaseAll()`；若你的外掛被停用、卸載或重啟後不再呼叫，此外掛會自動解鎖控制項，
  避免造成永久鎖死；
* **解除接管後保留已修改的設定值**，不會自動還原接管前的原值，由使用者依需求自行改回。

### 2. 非接管模式（`takeover: false`，預設）

* 改寫目標功能的設定檔並立即生效，**不鎖定控制項**；
* **僅在實際改變了目前設定值時**，在設定頁該功能的最後一行子行顯示黃色提示；若原值已與目標值一致，
  不產生黃字打擾使用者；
* 黃色提示會持久化儲存在外掛私有儲存的 `external-notices` 檔案中（不混入 `feature-*` 設定檔，
  也不影響設定匯出），跨重啟保留；
* 當使用者手動編輯該功能的任意設定，或執行「清除此外掛設定」「匯入設定」後，黃色提示自動取消。

## 方法說明

### `ready(): Promise<void>`

等待此外掛完成初始化（載入補丁、設定與持久化提示）。所有非同步 API 內部都會先等待它，通常無需手動呼叫。

### `setFeature(request): Promise<ExternalControlResult>`

請求參數：

| 欄位        | 型別                                               | 必填 | 說明                                                                             |
| ----------- | -------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `caller`    | `string \| { name: string; displayName?: string }` | 是   | 呼叫方外掛名，或直接傳入思源 `Plugin` 實例（優先即時取宿主外掛的 `displayName`） |
| `featureId` | `string`                                           | 是   | 目標功能 id（與 `src/features/<id>` 目錄名一致，如 `"modal-blur"`）              |
| `enabled`   | `boolean \| string`                                | 是   | 布林開關功能傳 `true` / `false`；下拉型開關傳 `false`（關閉）或合法選項值字串    |
| `takeover`  | `boolean`                                          | 否   | 是否接管鎖定，預設 `false`                                                       |
| `reason`    | `string \| Partial<Record<string, string>>`        | 否   | 可選補充原因，附在此外掛內建多語言提示後；支援字串或按介面語言對應的物件         |

成功回傳：

```ts
{
    ok: true,
    featureId: string,
    key: string,             // 實際修改的主控欄位名（如 "enabled" / "mode" / "scope"）
    value: boolean | string, // 實際生效的值
    changed: boolean,        // 本次呼叫是否改變了磁碟設定
    takeover: boolean,       // 本次呼叫後是否持有接管鎖
    release: () => void,     // 釋放本次接管的控制代碼（非接管呼叫時為空操作；冪等）
}
```

失敗回傳：

```ts
{
    ok: false,
    featureId: string,
    code:
        | "invalid-caller"  // caller 非法或為空
        | "invalid-feature" // 找不到該功能 id
        | "protected"       // 目標屬於受保護的「外掛本身」分類
        | "unavailable"     // 目前平台、思源版本或補丁宣告下該功能不可用
        | "no-switch"       // 該功能沒有可控制的開關（純動作/說明項）
        | "invalid-value"   // 值型別不對或不在下拉合法選項中
        | "readonly"        // 思源處於唯讀或發佈模式
        | "conflict"        // 與其他外掛的接管衝突
        | "write-failed"    // 寫入或讀回校驗失敗
        | "disposed",       // 此外掛已卸載
    message: string,
    holders?: string[],     // code 為 "conflict" 時，目前持有接管的外掛名列表
}
```

### `disableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: false, ...options })` 的便捷封裝，同時適用於布林開關與下拉型開關功能。

### `enableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: options?.value ?? true, ...options })` 的便捷封裝。對於有多個開啟檔位的下拉型開關（如 `inline-code-copy`、`outline-level-filter`、`exit-confirm`），請透過 `options.value` 明確指定目標選項值。

### `release(caller, featureId)` 與 `releaseAll(caller)`

釋放指定呼叫方在單一功能或全部功能上持有的接管鎖，冪等，回傳 `{ released: number, featureIds: string[] }`。

### `getFeatureState(featureId)` 與 `listControllableFeatures()`

唯讀查詢單一功能或全部可控制功能的狀態，回傳是否可用、是否可控、主控欄位中繼資料（含下拉選項與關閉值）、
目前設定值、執行開關態、目前接管列表與非接管提示資訊。

## 邊界與衝突規則

1. **受保護範圍**：「外掛本身」分類（如 `log-output`、`show-unavailable-settings`、`settings-search`）
   以及無開關功能不允許被外部控制，呼叫會回傳 `protected` / `no-switch`。
2. **不可用功能**：在目前端或目前思源版本下不可用、或被開發者/使用者補丁停用的功能不寫入，回傳 `unavailable`。
3. **多外掛衝突（相容共存 + 衝突拒絕）**：
   * 多個外掛以**相同目標值**接管同一功能時共同持有接管，設定頁逐行顯示所有接管方，全部釋放後才解鎖；
   * 已有接管時，其他外掛發起的非接管呼叫或**不同目標值**的接管呼叫直接回傳 `conflict`（先來先得）。
4. **卸載兜底**：若外部外掛停用或卸載時忘記呼叫 `releaseAll()`，此外掛會在開啟設定頁或後續 API 校驗時
   偵測到對方已不在 `app.plugins` 中並自動清理其接管。
5. **即時同步**：設定面板開啟期間發生接管、釋放或設定變更時，對應功能的控制項值、停用態與黃色提示行會原地即時更新。
6. **多視窗與獨立設定視窗**：桌面端開啟多個子視窗或「獨立視窗開啟設定介面」時，每個視窗擁有獨立的外掛實例；請僅在主視窗呼叫控制 API，並透過監聽 `some-settings-siyuan:ready` 在同步或跨視窗重載後重新宣告接管。
