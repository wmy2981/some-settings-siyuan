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

| Feature         | Category      | First-run state | What it verifies                                                        |
| --------------- | ------------- | --------------- | ----------------------------------------------------------------------- |
| `function-demo` | Functionality | `1`             | A plugin command that reads its settings — `switch` / `text` / `number` |
| `ui-demo`       | Interface     | `1`             | Reversible namespace-scoped CSS injection + `select` setting            |
| `dev-demo`      | Development   | `0`             | Logging settings and a registry snapshot — plus the `state: 0` path     |

## Settings panel

The plugin registers **no top bar button, no status bar item, no dock and no panel of its own**. It overrides
`Plugin.openSetting()`, which is exactly how SiYuan decides to show the _Settings_ button on a plugin card,
so open it from **Settings → Marketplace → Downloaded → (this plugin) → Settings**.

The panel is a single vertical list with the three categories (Functionality / Interface / Development) as
section headings — no side tabs, no footer bar, no extra buttons. Each category is followed directly by its
setting rows: every feature contributes one subtitle row (its name and description) and then its own rows, and
rows keep the thin divider line drawn by SiYuan's `.b3-label`. There is **no nested grouping at any level** —
`SettingField` has no group kind, so a hierarchy cannot even be expressed. Every row is "label on the left,
control on the right", using SiYuan's own classes (`b3-switch`, `b3-select`, `b3-text-field`, `b3-label`,
`config-item`, `config-title`), with the built-in `16px 24px` row padding left untouched.

**Saving** follows the built-in dialog: edit any number of settings, then click **Save** (or **Cancel** to
discard). Nothing is written until you save, and if a value fails validation the panel stays open with the
problem reported. If you have unsaved changes, closing asks for confirmation first.

Every save is **verified**: after writing each feature's file, the plugin reads it straight back and compares.
SiYuan's `saveData` can resolve before the file actually lands on disk (and never inspects the kernel's
response code), so a write can fail while looking successful. If the read-back disagrees, the panel stays open
and tells you exactly which field differs, and the console gets a `[some-settings-siyuan]` line — check there
first if a setting ever appears not to stick.

On narrow screens (mobile, or a window narrower than 750px — the same breakpoint the kernel uses) the panel
switches to a stacked layout: the label takes a full row and the control moves to the next row at full width,
and the dialog's padding is reduced so the content uses the whole screen.

Because a feature with `state: 3` still shows its controls, saving there writes the feature's own JSON file
even though nothing was loaded from it at startup — the four states govern _reading_, never whether an
explicit user edit persists.

## Repository layout

```text
some-settings-siyuan/
├── feature-control.json        # the only switchboard: four states per feature id
├── plugin.json                 # marketplace manifest
├── src/
│   ├── index.ts                # plugin entry: onload / onunload / uninstall / openSetting
│   ├── i18n/{en,zh-CN}.json    # UI strings
│   ├── core/                   # mechanism layer, no business feature lives here
│   │   ├── types.ts            # FeatureDefinition / SettingField / FeatureHost
│   │   ├── control.ts          # reads feature-control.json, normalises the four states
│   │   ├── registry.ts         # the only file that imports every feature
│   │   ├── config.ts           # per-feature JSON load / save (draft commit) / reset
│   │   ├── style.ts            # reversible CSS injection
│   │   ├── ui.ts               # native-style UI primitives
│   │   ├── error.ts            # error isolation, never lets a feature break the plugin
│   │   ├── setting-dialog.ts   # the single-list settings panel with Save / Cancel
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
7. Only use `FeatureHost` for platform access (`addCommand`, `addEventBus`, `addStyle`, `addTopBar`, …).
   Features must not import each other; shared logic goes in `src/core/`.
8. `settings` accepts `switch` / `text` / `number` / `select`. There is deliberately no button control: the
   settings panel registers nothing but setting rows. There is no group kind either — the panel is one flat
   level, and a group would put the hierarchy straight back.

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
* The plugin puts nothing in the top bar or status bar by design; the only entry point is SiYuan's own
  _Settings_ button on the plugin card in **Marketplace → Downloaded**.
* Saving is atomic per panel session: **Save** writes every changed feature's JSON file, **Cancel** writes
  nothing. There is no per-item reset button in the panel; delete the feature's JSON file under
  `data/storage/petal/some-settings-siyuan/` to restore defaults.
* Re-registering a plugin command after a feature is disabled requires reloading the plugin: the host API
  has no per-command removal, so commands are released together with the plugin.
* `dev-refs/` is a local, untracked development reference and is intentionally excluded from version control.

## License

MIT
