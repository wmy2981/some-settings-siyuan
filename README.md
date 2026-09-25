[中文](README.zh-CN.md)

# Some Settings

> A SiYuan plugin that ships a batch of **independently toggleable** desktop and mobile enhancements.

Every setting item lives in its own folder, keeps its own JSON file, and can be enabled, disabled, hidden
and reset on its own — without touching any source code.

* Minimum SiYuan version: `3.8.6-alpha.4`
* Frontend environments: desktop, mobile, desktop window, browser
* Backend environments: all

## Core idea

One manifest at the repository root decides what loads and what is visible:

```jsonc
// feature-control.json
{
  "version": 1,
  "features": {
    "function-demo": { "state": 1 },
    "ui-demo": { "state": 1 },
    "dev-demo": { "state": 0 }
  }
}
```

| `state` | Load existing config | Show settings UI | Run the feature |
| ------- | -------------------- | ---------------- | --------------- |
| `0`     | no                   | no               | no              |
| `1`     | yes                  | yes              | yes             |
| `2`     | yes                  | no               | yes             |
| `3`     | no                   | yes              | yes             |

Every state is useful:

* **`0`** — retire an outdated feature entirely while keeping its code in the repository
* **`1`** — normal, fully working feature
* **`2`** — keep the behaviour running for existing users but hide it from new ones
* **`3`** — show and edit the settings without letting the feature run

A missing key, an out-of-range value or an unknown id is treated as `0` at runtime, and
`npm run check` refuses to build until the manifest and the code agree again.

## Features

This release is the plugin skeleton plus one example item per category, so the whole chain is verifiable
end to end. Real features are added one folder at a time.

| Feature         | Category      | First-run state | What it verifies                                                                 |
| --------------- | ------------- | --------------- | -------------------------------------------------------------------------------- |
| `function-demo` | Functionality | `1`             | Top bar button + plugin command + `switch` / `text` / `number` settings          |
| `ui-demo`       | Interface     | `1`             | Reversible namespace-scoped CSS injection + `select` setting                     |
| `dev-demo`      | Development   | `0`             | `action` settings, config export, registry diagnostics — and the `state: 0` path |

## Settings panel

Open it from the plugin's top bar button (on mobile, tap the icon; on desktop, the same button also has a
right-click menu entry). The panel has three categories — **Functionality / Interface / Development** — and
uses SiYuan's own classes (`b3-switch`, `b3-select`, `b3-text-field`, `b3-button`, `config-item`,
`config-title`, `config-items`) with the same sizing and spacing as the built-in settings panels.

Changes are written immediately. The one deliberate difference from the built-in `Setting` component is that
this panel has no global _Save_ button: each control persists on change, because every item must be
independently resettable. Use **Reset this feature** to delete that feature's JSON file and restore defaults.

## Repository layout

```text
some-settings-siyuan/
├── feature-control.json        # the only switchboard: four states per feature id
├── plugin.json                 # marketplace manifest
├── src/
│   ├── index.ts                # plugin entry: onload / onLayoutReady / onunload / uninstall
│   ├── i18n/{en,zh-CN}.json    # UI strings
│   ├── core/                   # mechanism layer, no business feature lives here
│   │   ├── types.ts            # FeatureDefinition / SettingField / FeatureHost
│   │   ├── control.ts          # reads feature-control.json, normalises the four states
│   │   ├── registry.ts         # the only file that imports every feature
│   │   ├── config.ts           # per-feature JSON load / save / reset
│   │   ├── style.ts            # reversible CSS injection
│   │   ├── ui.ts               # native-style UI primitives
│   │   ├── error.ts            # error isolation, never lets a feature break the plugin
│   │   ├── setting-dialog.ts   # the three-category settings panel
│   │   └── bootstrap.ts        # loads and mounts features according to the manifest
│   └── features/
│       ├── function-demo/{index.ts,demo.ts}
│       ├── ui-demo/{index.ts,style.ts}
│       └── dev-demo/{index.ts,dev.ts}
├── assets/                     # icon.svg/icon.png, preview.html/preview.png + render scripts output
└── scripts/
    ├── check-features.mjs      # manifest <-> registry consistency gate
    ├── render-icon.mjs         # icon.svg -> 160x160 icon.png (<= 64 KiB)
    ├── render-preview.mjs      # preview.html -> 1024x768 preview.png (<= 512 KiB)
    └── release-notes.mjs       # Conventional Commits -> release notes
```

Where the data lives at runtime, in the workspace:
`data/storage/petal/some-settings-siyuan/feature-<id>.json`. All access goes through
`plugin.loadData` / `saveData` / `removeData`; the plugin never calls `fs` or any Node API.

## Adding a feature

1. Create `src/features/<id>/` (`<id>` is lowercase, digits and hyphens only).
2. Add `index.ts` exporting `defineFeature({id, category, name, description, settings, mount})`.
   `name` and `description` are i18n keys, not literals. Put the implementation in a sibling file.
3. Register it in `src/core/registry.ts` (a single import line plus one array entry).
4. Add its id to `feature-control.json` and choose a state.
5. Add every i18n key you referenced to **both** `src/i18n/en.json` and `src/i18n/zh-CN.json`.
6. Run `npm run check`, `npm run typecheck`, `npm run lint`.
7. Only use `FeatureHost` for platform access (`addTopBar`, `addCommand`, `addEventBus`, `addStyle`, …).
   Features must not import each other; shared logic goes in `src/core/`.

## Development

```bash
npm install
npm run dev          # webpack watch, writes index.js / index.css and copies i18n/ into the repo root
npm run check        # feature-control manifest consistency
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format:check # dprint check
npm run build        # check + production bundle + package.zip
```

For a live development loop, place this folder so SiYuan can load it (for example under
`<workspace>/data/plugins/`), run `npm run dev`, and enable the plugin in
**Settings → Marketplace → Downloaded**. `npm run build` produces the marketplace-ready `package.zip`
with a flat structure (`index.js`, `index.css`, `plugin.json`, `i18n/`, `icon.png`, `preview.png`, `README*.md`).

## Design rules

* **Native first** — only official plugin APIs, the event bus, kernel APIs and SiYuan's own CSS classes.
* **No core DOM rewrites** — preferences are CSS, event listeners and official extension points.
* **Module isolation** — one folder per feature; features never import each other.
* **Always reversible** — any feature failure is caught and reported, never propagated; teardown is idempotent.
* **Configurable by default off** — anything unspecified defaults to off or follows SiYuan's own setting.

## Known limitations

* Turning a feature off does **not** remove its code from the bundle. Gating is runtime-only, so that
  changing `feature-control.json` never requires a source edit or a conditional import. The trade-off is
  bundle size versus the ability to disable something by editing one data file.
* The settings panel has no global _Save_ button (see above).
* Re-registering a plugin command after a feature is disabled requires reloading the plugin: the host API
  has no per-command removal, so commands are released together with the plugin.
* `dev-refs/` is a local, untracked development reference and is intentionally excluded from version control.

## License

MIT
