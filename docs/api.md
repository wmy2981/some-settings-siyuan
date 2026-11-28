**English** | [简体中文](api.zh-CN.md) | [繁體中文](api.zh-TW.md) | [日本語](api.ja.md) | [Türkçe](api.tr.md) | [Português](api.pt-BR.md)

# External Plugin Control API

When another SiYuan plugin conflicts with one of this plugin's features (or needs a specific feature toggled), it can
use the `api` property exposed on this plugin instance to enable or disable the target feature's persisted configuration
(`feature-<id>` config file, **not** `.patch.yml`), with an optional takeover lock.

## Discovering the API and Load Order

SiYuan loads plugins concurrently, so your plugin may start before `some-settings-siyuan` or remain loaded while this
plugin reloads. Handle both immediate lookup and lifecycle events:

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

Full integration example (with hot-reload and cleanup on unload):

```ts
export default class MyPlugin extends Plugin {
    private onReady = (event: Event) => {
        const detail = (event as CustomEvent<{api: SomeSettingsApi;}>).detail;
        void this.applyCompatibility(detail.api);
    };

    onload() {
        window.addEventListener("some-settings-siyuan:ready", this.onReady);
        // plugin.api is already available even while some-settings-siyuan is still running onload;
        // async methods wait for initialization automatically.
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

### Lifecycle Events

| Event Name (`window`)         | Fired When                        | `event.detail` Payload         |
| ----------------------------- | --------------------------------- | ------------------------------ |
| `some-settings-siyuan:ready`  | After this plugin finishes `load` | `{ pluginName, version, api }` |
| `some-settings-siyuan:unload` | When this plugin unloads          | `{ pluginName, version }`      |

## Two Control Modes

### 1. Takeover Mode (`takeover: true`)

* Writes the target feature's config file and applies immediately (mounting or unmounting the feature);
* The feature's title, description and yellow notice stay crisp and readable in the settings panel, while **all controls
  under that feature are disabled and grayed out**;
* A persistent yellow notice row is displayed as the last child row of the feature (even if the config value was already
  the same);
* **Takeover locks are runtime-only (in memory)**: your plugin should declare its takeover on each startup and call
  `release()` / `releaseAll()` in `onunload()`. If your plugin is disabled, uninstalled, or does not re-declare on the
  next restart, controls unlock automatically so settings are never permanently locked;
* **Releasing a takeover keeps the written config value** rather than rolling back to the previous value; users can
  change it back if they wish.

### 2. Non-takeover Mode (`takeover: false`, default)

* Writes the target feature's config file and applies immediately **without locking controls**;
* Displays a yellow notice as the last child row **only when the config value actually changed** (no notice is shown when
  the setting already matched the requested value);
* The notice is persisted separately in `external-notices` inside the plugin's storage directory (never mixed into
  `feature-*` config files or config exports) so it survives restarts;
* Once the user edits any setting of that feature, or clears/imports all plugin configs, the notice is dismissed and
  removed from storage.

## Methods

### `ready(): Promise<void>`

Resolves once this plugin finishes initialization (patches, configs and persisted notices). All async API methods wait
on it automatically.

### `setFeature(request): Promise<ExternalControlResult>`

Parameters:

| Field       | Type                                               | Required | Description                                                                                       |
| ----------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `caller`    | `string \| { name: string; displayName?: string }` | Yes      | Caller plugin name, or a SiYuan `Plugin` instance (live `displayName` is preferred when present)  |
| `featureId` | `string`                                           | Yes      | Target feature id (matches `src/features/<id>`, e.g. `"modal-blur"`)                              |
| `enabled`   | `boolean \| string`                                | Yes      | `true` / `false` for boolean switches; `false` (off) or a valid option string for select switches |
| `takeover`  | `boolean`                                          | No       | Whether to lock controls, default `false`                                                         |
| `reason`    | `string \| Partial<Record<string, string>>`        | No       | Optional reason appended to the localized notice; accepts a string or language-keyed map          |

Success response:

```ts
{
    ok: true,
    featureId: string,
    key: string,             // Primary switch field key (e.g. "enabled" / "mode" / "scope")
    value: boolean | string, // Applied value
    changed: boolean,        // Whether the stored config value changed
    takeover: boolean,       // Whether the caller holds a takeover lock
    release: () => void,     // Idempotent handle to release this takeover (no-op when takeover is false)
}
```

Failure response:

```ts
{
    ok: false,
    featureId: string,
    code:
        | "invalid-caller"  // Empty or invalid caller
        | "invalid-feature" // Unknown feature id
        | "protected"       // Feature belongs to the protected "plugin" category
        | "unavailable"     // Feature is unavailable on this frontend, SiYuan version, or patch
        | "no-switch"       // Feature has no controllable switch
        | "invalid-value"   // Wrong value type or unknown select option
        | "readonly"        // SiYuan is in read-only or publish mode
        | "conflict"        // Conflicts with an active takeover by another plugin
        | "write-failed"    // Save or read-back verification failed
        | "disposed",       // This plugin has been unloaded
    message: string,
    holders?: string[],     // Active takeover holder names when code is "conflict"
}
```

### `disableFeature(caller, featureId, options?)`

Shorthand for `setFeature({ caller, featureId, enabled: false, ...options })`. Works uniformly for both boolean and
select-switch features.

### `enableFeature(caller, featureId, options?)`

Shorthand for `setFeature({ caller, featureId, enabled: options?.value ?? true, ...options })`. For select-switch
features with multiple enabled options (such as `inline-code-copy`, `outline-level-filter`, `exit-confirm`), pass
`options.value` explicitly.

### `release(caller, featureId)` and `releaseAll(caller)`

Idempotently release takeover locks held by `caller` for one feature or all features. Returns
`{ released: number, featureIds: string[] }`.

### `getFeatureState(featureId)` and `listControllableFeatures()`

Read-only queries returning availability, controllability, switch metadata (including select options and off-value),
current stored value, running state, active takeovers, and any persisted non-takeover notice.

## Boundaries and Conflict Rules

1. **Protected features**: Features in the `plugin` ("This plugin") category (such as `log-output`,
   `show-unavailable-settings`, `settings-search`) and switchless action/note features cannot be controlled externally
   (`protected` / `no-switch`).
2. **Unavailable features**: Features unavailable on the current frontend/version or disabled by declaration/patch are not
   written (`unavailable`).
3. **Multi-plugin conflicts (shared when compatible, rejected on conflict)**:
   * Multiple plugins taking over the same feature with the **same target value** share the lock; all holders are listed
     line by line and controls unlock only when all holders release;
   * While a feature is taken over, any non-takeover call or any takeover with a **different target value** from another
     plugin fails with `conflict` (first-come, first-served).
4. **Unloaded caller fallback**: If a caller plugin is disabled or uninstalled without calling `releaseAll()`, this
   plugin detects that it is no longer present in `app.plugins` on panel open or API inspection and automatically clears
   its stale takeover.
5. **Live panel sync**: If the settings panel is open when a takeover, release, or external config change occurs, the
   affected feature's control values, disabled state, and yellow notice row update in place.
6. **Multi-window and separate settings window**: On desktop, each sub-window and separate settings window hosts its own
   plugin instance; invoke the control API only from the main window and re-declare takeovers on
   `some-settings-siyuan:ready` after sync or cross-window reloads.
