[English](api.md) | [简体中文](api.zh-CN.md) | [繁體中文](api.zh-TW.md) | **日本語** | [Türkçe](api.tr.md) | [Português](api.pt-BR.md)

# 外部プラグイン制御 API

他の SiYuan プラグインが本プラグインの特定の機能と競合する場合（または協調して有効化したい場合）、本プラグインの
インスタンスに公開されている `api` プロパティから対象機能の永続設定（`feature-<id>` 設定ファイルであり、
`.patch.yml` 宣言パッチでは**ありません**）を有効・無効にし、必要に応じて「引き継ぎロック」を掛けることができます。

## API の取得と読み込み順序

SiYuan では各プラグインが並行して読み込まれるため、呼び出し元のプラグインが `some-settings-siyuan` より先に起動したり、
動作中に本プラグインがリロードされたりすることがあります。即時取得とライフサイクルイベントの両方に対応してください：

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

完全な組み込み例（ホットリロードおよびアンロード時の解放に対応）：

```ts
export default class MyPlugin extends Plugin {
    private onReady = (event: Event) => {
        const detail = (event as CustomEvent<{api: SomeSettingsApi;}>).detail;
        void this.applyCompatibility(detail.api);
    };

    onload() {
        window.addEventListener("some-settings-siyuan:ready", this.onReady);
        // some-settings-siyuan が onload 処理中でも plugin.api はすでに存在し、
        // 非同期メソッドは初期化完了を自動的に待機します。
        const api = getSomeSettingsApi(this);
        if (api) {
            void this.applyCompatibility(api);
        }
    }

    private async applyCompatibility(api: SomeSettingsApi) {
        await api.disableFeature(this, "modal-blur", {
            takeover: true,
            reason: {
                ja: "本プラグインのカスタムモーダルスタイルと競合するため",
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

### ライフサイクルイベント

| イベント名（`window`）        | 発火タイミング             | `event.detail` 内容            |
| ----------------------------- | -------------------------- | ------------------------------ |
| `some-settings-siyuan:ready`  | 本プラグインの初期化完了後 | `{ pluginName, version, api }` |
| `some-settings-siyuan:unload` | 本プラグインのアンロード時 | `{ pluginName, version }`      |

## 2 つの制御モード

### 1. 引き継ぎモード（`takeover: true`）

* 対象機能の設定ファイルを書き換え、即座に反映（マウント／アンマウント）します；
* 設定画面ではタイトル・説明・黄色の通知テキストをはっきり表示したまま、その機能の**すべての操作コントロールを無効化してグレーアウト**します；
* 元の設定値が変わったかどうかに関わらず、機能の末尾子行として黄色の通知行を常時表示します；
* **引き継ぎ状態は実行中のメモリ上にのみ保持されます**：呼び出し元プラグインは毎回起動時に引き継ぎを宣言し、`onunload()` で
  `release()` / `releaseAll()` を呼んでください。呼び出し元が無効化・アンインストールされた場合や再起動後に再宣言しなかった場合は自動的にロックが解除され、設定が永久にロックされることはありません；
* **引き継ぎ解除後も書き換え済みの設定値は維持されます**（自動的には元の値へ戻しません）。

### 2. 非引き継ぎモード（`takeover: false`、既定）

* 対象機能の設定ファイルを書き換えて即座に反映し、**コントロールはロックしません**；
* **現在の設定値が実際に変更された場合のみ**、機能の末尾子行として黄色の通知行を表示します（すでに同じ値だった場合は通知を出しません）；
* 通知はプラグイン専用ストレージ内の `external-notices` に独立して永続化され（`feature-*` 設定ファイルやエクスポート内容には混ざりません）、再起動後も残ります；
* ユーザーがその機能の任意の設定を編集するか、「設定をすべて消去」「インポート」を実行すると通知は自動的に消えます。

## メソッド一覧

### `ready(): Promise<void>`

本プラグインの初期化（パッチ・設定・永続通知の読み込み）完了を待ちます。すべての非同期 API は内部で自動的に待機します。

### `setFeature(request): Promise<ExternalControlResult>`

リクエスト引数：

| フィールド  | 型                                                 | 必須   | 説明                                                                                            |
| ----------- | -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `caller`    | `string \| { name: string; displayName?: string }` | はい   | 呼び出し元プラグイン名、または SiYuan の `Plugin` インスタンス（現在の `displayName` を優先）   |
| `featureId` | `string`                                           | はい   | 対象機能 ID（`src/features/<id>` のフォルダ名、例：`"modal-blur"`）                             |
| `enabled`   | `boolean \| string`                                | はい   | 真偽値スイッチは `true` / `false`；セレクト型スイッチは `false`（無効）または有効な選択肢文字列 |
| `takeover`  | `boolean`                                          | いいえ | 引き継ぎロックを行うか（既定 `false`）                                                          |
| `reason`    | `string \| Partial<Record<string, string>>`        | いいえ | 任意の補足理由。文字列または言語コードをキーにしたオブジェクト                                  |

成功時の戻り値：

```ts
{
    ok: true,
    featureId: string,
    key: string,             // 対象スイッチのフィールド名（"enabled" / "mode" / "scope" など）
    value: boolean | string, // 適用された値
    changed: boolean,        // 保存値が実際に変化したか
    takeover: boolean,       // 引き継ぎロックを保持しているか
    release: () => void,     // この引き継ぎを解放する冪等ハンドル（非引き継ぎ時は何もしない）
}
```

失敗時の戻り値：

```ts
{
    ok: false,
    featureId: string,
    code:
        | "invalid-caller"  // caller が空または不正
        | "invalid-feature" // 機能 ID が存在しない
        | "protected"       // 保護対象の「このプラグイン」カテゴリに属する
        | "unavailable"     // 現在のフロントエンド・SiYuan バージョン・パッチで利用不可
        | "no-switch"       // 制御可能なスイッチを持たない機能
        | "invalid-value"   // 型違いまたは無効な選択肢
        | "readonly"        // 読み取り専用または公開モード
        | "conflict"        // 他プラグインの引き継ぎと競合
        | "write-failed"    // 書き込みまたは読み戻し検証に失敗
        | "disposed",       // 本プラグインがアンロード済み
    message: string,
    holders?: string[],     // code が "conflict" のとき、現在引き継ぎ中のプラグイン名一覧
}
```

### `disableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: false, ...options })` の短縮メソッドです。真偽値スイッチ・セレクト型スイッチのどちらにもそのまま使えます。

### `enableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: options?.value ?? true, ...options })` の短縮メソッドです。複数の有効選択肢を持つセレクト型スイッチでは `options.value` に選択肢を指定してください。

### `release(caller, featureId)` と `releaseAll(caller)`

指定した呼び出し元が保持している単一機能または全機能の引き継ぎロックを冪等に解放し、`{ released: number, featureIds: string[] }` を返します。

### `getFeatureState(featureId)` と `listControllableFeatures()`

単一機能または制御可能な全機能の状態（利用可否・制御可否・スイッチ情報・現在値・実行状態・引き継ぎ一覧・永続通知）を読み取り専用で取得します。

## 境界と競合ルール

1. **保護範囲**：「このプラグイン（`plugin`）」カテゴリの機能（`log-output`、`show-unavailable-settings`、`settings-search` 等）およびスイッチを持たない機能は外部制御できません（`protected` / `no-switch`）。
2. **利用不可な機能**：現在の端末・SiYuan バージョンで利用不可、または宣言・パッチで無効化された機能は書き込まず `unavailable` を返します。
3. **複数プラグイン間の競合（一致時は共存・不一致時は拒否）**：
   * 複数プラグインが**同じ目標値**で引き継ぐ場合は共同でロックを保持し、全員が解放するまでロックを維持します；
   * すでに引き継ぎ中の機能に対して、他プラグインからの非引き継ぎ呼び出しや**異なる目標値**での引き継ぎ呼び出しは `conflict` を返します（先着優先）。
4. **アンロード時のフォールバック**：呼び出し元が `releaseAll()` を呼ばずに無効化・アンインストールされた場合でも、設定画面を開く際や API 参照時に `app.plugins` から消えていることを検知し、自動的に引き継ぎを解放します。
5. **リアルタイム同期**：設定パネルを開いたまま引き継ぎ・解放・設定変更が行われた場合、コントロール値・無効状態・黄色の通知行はその場でリアルタイム更新されます。
6. **マルチウィンドウおよび独立設定ウィンドウ**：デスクトップ版では各サブウィンドウと独立設定ウィンドウがそれぞれ別のプラグインインスタンスを持ちます。制御 API はメインウィンドウからのみ呼び出し、同期やウィンドウ間のリロード後に引き継ぎを再宣言できるよう `some-settings-siyuan:ready` を監視してください。
