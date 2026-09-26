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
    "modal-blur": { "state": 1 },
    "code-block-lang-empty": { "state": 1 },
    "mobile-console-log": { "state": 0 }
  }
}
```

| `state` | Load existing config | Show settings UI | Allowed to run |
| ------- | -------------------- | ---------------- | -------------- |
| `0`     | no                   | no               | no             |
| `1`     | yes                  | yes              | yes            |
| `2`     | yes                  | no               | yes            |
| `3`     | no                   | yes              | yes            |

Every state is useful:

* **`0`** — retire an outdated feature entirely while keeping its code in the repository
* **`1`** — normal, available
* **`2`** — keeps running, but its rows are hidden from the panel
* **`3`** — show and edit the settings without loading the stored config

A missing key, an out-of-range value or an unknown id is treated as `0` at runtime, and
`npm run check` refuses to build until the manifest and the code agree again.

A feature can also declare that it only applies to one frontend (`frontends: ["mobile"]`). When it does,
the other frontend neither mounts it nor lists it in the settings panel.

### The manifest decides "may", the switch decides "does"

Those are deliberately two different things:

* `feature-control.json` only decides whether **stored config is loaded** and whether the feature's
  **rows appear in the panel**
* whether a feature actually **runs** is its own control's job — the first row of every feature is an
  `enabled` switch that defaults to **off**, and its dropdowns/inputs are its parameters

So a fresh install has **every feature off** and you turn them on one by one under
**Settings → Marketplace → Downloaded → (this plugin) → Settings**. Switching one off unmounts it
completely — styles, listeners and injected nodes are all released — with no plugin reload.
Two features are the exception because their own requirement is a selector that already includes an
"off" option: `inline-code-copy` and `mobile-longpress-menu-label`.

A feature with `state: 2` has no switch to click, so it counts as allowed to run; otherwise that state
would be one that can never do anything.

## Features

### Functionality

| Feature                   | Frontend | What it does                                                                                                                    |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `code-block-lang-empty`   | both     | New code blocks always start with an empty language instead of reusing the last one picked                                      |
| `daily-note-direct`       | both     | Creates the daily note in a chosen notebook without asking; creation still runs through SiYuan's own code                       |
| `first-doc-icon`          | both     | Uses a configured emoji the first time a document gets an icon instead of a random one                                          |
| `external-link-confirm`   | both     | Asks before opening an http/https link and shows the full original URL                                                          |
| `kernel-reconnect-button` | both     | Adds a _Reconnect now_ button to the kernel-disconnected panel (experimental)                                                   |
| `kernel-auto-reconnect`   | both     | Probes the kernel on its own schedule while disconnected and reloads as soon as it answers (experimental, 2 × 500ms by default) |

### Interface

| Feature                       | Frontend | What it does                                                                                                      |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `modal-blur`                  | both     | Backdrop blur behind dialogs, so the editor underneath softens while the dialog stays sharp                       |
| `doc-tree-opened-accent`      | both     | Flush accent bar on the left edge of the opened note in the document tree, with a custom colour                   |
| `inline-code-copy`            | both     | Copy button for inline code: off, on hover (recommended), or always                                               |
| `code-snippet-highlight`      | both     | Colours the snippet editor using SiYuan's own highlight.js and current code theme                                 |
| `desktop-command-panel-slim`  | desktop  | Shrinks the command panel to a share of SiYuan's native width (50% by default)                                    |
| `mobile-sidebar-blur`         | mobile   | Backdrop blur behind the mobile side panels                                                                       |
| `mobile-dock-blur`            | mobile   | Backdrop blur behind the floating mobile dock bar                                                                 |
| `mobile-bar-animation`        | mobile   | Smooth transition for the top bar, breadcrumb and dock bar show/hide; the dock bar only shows or hides as a whole |
| `mobile-ref-panel-height`     | mobile   | Taller mobile candidate panel (including reference search), never past the visible area                           |
| `mobile-tab-doc-icon`         | mobile   | SVG, emoji, or SiYuan's own setting for the default document icon in the tab overview                             |
| `mobile-sync-button`          | mobile   | Keeps Sync visible in the top-right corner; the click stays SiYuan's own sync guide                               |
| `mobile-select-native`        | mobile   | Dropdowns use SiYuan's own menu instead of the WebView picker                                                     |
| `mobile-longpress-menu-label` | mobile   | Adds text to the copy/paste buttons in the long-press menu (off, copy, paste, or both)                            |
| `mobile-block-icon-always`    | mobile   | Keeps the operated block's icon visible instead of letting it flicker                                             |
| `hide-mobile-exit`            | mobile   | Hides the icon-only Quit button in the mobile side panel                                                          |

### Development

| Feature              | Frontend | What it does                                                                                             |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `mobile-console-log` | mobile   | Collects console output from the moment the plugin loads and shows the full log, with copy-all and clear |

## Settings panel

The plugin registers **no top bar button, no status bar item and no dock**. It overrides
`Plugin.openSetting()`, which is exactly how SiYuan decides to show the _Settings_ button on a plugin card,
so open it from **Settings → Marketplace → Downloaded → (this plugin) → Settings**.

The panel is a single vertical list with the three categories (Functionality / Interface / Development) as
section headings — no side tabs, no footer bar. Each category is followed directly by its setting rows:
a feature's first row is the feature itself (name, description and its off-by-default switch) and its
parameters follow underneath, with rows keeping the thin divider line drawn by SiYuan's `.b3-label`.
There is **no nested grouping at any level** —
`SettingField` has no group kind, so a hierarchy cannot even be expressed. Text has two roles and two
weights only: **only the feature name is bold**; its sub-items and descriptions are not. Every row is
"label on the left, control on the right", using SiYuan's own classes (`b3-switch`, `b3-select`,
`b3-text-field`, `b3-label`, `config-item`, `config-title`), with the built-in `16px 24px` row padding left
untouched. Features whose switch _is_ a selector (`inline-code-copy`, `mobile-longpress-menu-label`) keep
that dropdown on the name row instead of giving it a row of its own.
Features that only work on one frontend are **hidden from the panel on the other one**: mobile-only items
never appear on desktop, and desktop-only items (`desktop-command-panel-slim`) never appear on mobile.

**Saving** follows the built-in dialog: edit any number of settings, then click **Save** (or **Cancel** to
discard). Nothing is written until you save, and if a value fails validation the panel stays open with the
problem reported. If you have unsaved changes, closing asks for confirmation first.

Every save is **verified**: after writing each feature's file, the plugin reads it straight back and compares.
SiYuan's `saveData` can resolve before the file actually lands on disk (and never inspects the kernel's
response code), so a write can fail while looking successful. If the read-back disagrees, the panel stays open
and tells you exactly which field differs, and the console gets a `[some-settings-siyuan]` line — check there
first if a setting ever appears not to stick.

On narrow screens (mobile, or a window narrower than 750px — the same breakpoint the kernel uses) the panel
switches to a stacked layout: a **parameter** row's label takes a full row and its control moves to the next
row at full width, and the dialog's padding is reduced so the content uses the whole screen. A feature's own
name row keeps its left/right layout, so its switch or dropdown is never pushed onto a second line.

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
│   │   ├── frontend.ts         # the single place that decides desktop vs mobile
│   │   ├── registry.ts         # the only file that imports every feature
│   │   ├── config.ts           # per-feature JSON load / save (draft commit) / reset
│   │   ├── style.ts            # reversible CSS injection
│   │   ├── ui.ts               # native-style UI primitives
│   │   ├── error.ts            # error isolation, never lets a feature break the plugin
│   │   ├── setting-dialog.ts   # the single-list settings panel with Save / Cancel
│   │   └── bootstrap.ts        # loads and mounts features according to the manifest
│   └── features/<id>/{index.ts,<impl>.ts}
├── assets/                     # icon.svg/icon.png, preview.html/preview.png
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
8. `settings` offers four value controls and one action row:
   * every feature **must** have a control that defaults to off: a `switch` with `key: "enabled"` and
     `default: false`, or an `isEnabled(config)` predicate (the escape hatch for a feature whose own
     requirement is a selector that already includes an "off" option). `npm run check` refuses a feature
     that has neither
   * `switch` / `text` / `number` / `select` take part in config reading and in Save / Cancel
   * a `select` can use `optionsProvider` instead of a static `options` list to compute its candidates each
     time the panel opens (notebooks, plugin lists and other runtime-only data); no whitelist is applied then
   * `button` fires an action and has no persisted value at all (for example "open the console log").
     It stays out of the draft and is disabled in read-only / publish mode
     There is still no group kind — the panel is one flat level, and a group would put the hierarchy straight back.
9. A feature that is **off is not mounted**, so its implementation must not rely on `addTopBar` / `addDock` /
   `addTab` / `addCommand`, which have to be registered synchronously during onload. If one ever needs them,
   its `mount` has to run unconditionally and gate itself on the switch.

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
* **No core DOM rewrites** — preferences are CSS, event listeners and official extension points. Where the
  plugin must touch the DOM it only adds (an attribute, a button, or the markup the kernel itself just
  rendered) and never removes or edits a kernel node.
* **Module isolation** — one folder per feature; features never import each other.
* **Always reversible** — any feature failure is caught and reported, never propagated; teardown is
  idempotent and restores preferences, property descriptors and markers it added.
* **Configurable by default off** — anything unspecified defaults to off or follows SiYuan's own setting.

## Known limitations

* Turning a feature off does **not** remove its code from the bundle. Gating is runtime-only, so that
  changing `feature-control.json` never requires a source edit or a conditional import. The trade-off is
  bundle size versus the ability to disable something by editing one data file.
* **A feature that is off is not mounted**, so it cannot use `addTopBar` / `addDock` / `addTab` /
  `addCommand`, which must be registered synchronously during onload. None of the 22 features need them;
  one that does would have to mount unconditionally and gate itself on the switch.
* `mobile-console-log` only starts collecting console output once its switch is on, so by design the logs
  from plugin startup, and from before you flipped the switch, are not recorded. Turn it on and reproduce
  the problem.
* The plugin puts nothing in the top bar or status bar by design; the only entry point is SiYuan's own
  _Settings_ button on the plugin card in **Marketplace → Downloaded**.
* Saving is atomic per panel session: **Save** writes every changed feature's JSON file, **Cancel** writes
  nothing. There is no per-item reset button in the panel; delete the feature's JSON file under
  `data/storage/petal/some-settings-siyuan/` to restore defaults.
* **"Reconnect now" means reloading the frontend.** The kernel gives plugins no way to rebuild the main
  WebSocket — `Model.connect` needs the `msgCallback` that only exists in the kernel's boot closure, and
  calling it again would silently drop every kernel push. Both `kernel-reconnect-button` and
  `kernel-auto-reconnect` therefore reload the page once the kernel is reachable again. Note content always
  lives in the kernel and is written as you go, so a reload never loses a document.
* `first-doc-icon` writes the document's `icon` attribute and refreshes the title area, the document tree,
  pinned rows and the outline in place.
* `code-snippet-highlight` depends on SiYuan's own highlight.js. If that never loads, the plugin tears the
  highlight layer down and leaves the editor as plain text rather than leaving an unreadable input.
* `mobile-select-native` is best-effort: on some kernel/platform combinations the system picker still opens,
  in which case the select behaves exactly as it does without the plugin.
* **Copying on mobile goes through the native bridge the apps inject.** The Android and iOS WebViews do not
  grant clipboard write access to the page, so `navigator.clipboard` is refused there. _Copy all_ in
  `mobile-console-log` and the `inline-code-copy` button therefore use `JSAndroid.writeClipboard` /
  `webkit.messageHandlers.setClipboard` on mobile, the Clipboard API on desktop and in browsers, and fall
  back to `execCommand("copy")` in both cases.
* `inline-code-copy`'s "on hover" mode follows the **caret** on mobile: there is no hover with a finger, so
  the button appears as soon as the caret (or a selection) lands inside an inline code span, and the button
  itself is a size larger. Clicking it does not steal focus from the editor — the keyboard and the caret stay
  where they were.
* `mobile-tab-doc-icon` replaces the **whole** icon element when a tab has no icon: SiYuan renders
  `<svg class="mobile-tabs__item-icon">` in that case and an SVG cannot hold an emoji (raw text nodes are not
  rendered), so the plugin switches it for the `<span>` SiYuan itself uses for emoji icons.
* Re-registering a plugin command after a feature is disabled requires reloading the plugin: the host API
  has no per-command removal, so commands are released together with the plugin.

## License

[MIT](./LICENSE)
