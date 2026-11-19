[简体中文](patch.zh-CN.md) | [繁體中文](patch.zh-TW.md)

# User-level declaration patch: `.patch.yml`

Whether a feature ships at all, which settings tab it belongs to, which frontend it applies to and
which SiYuan versions it supports are all decided by the feature declarations in the plugin source
and released together with the plugin; the interface texts come from the language files shipped with
the plugin as well. If you want to change one of those on your own machine — for example to turn a
feature off completely, move it to another tab, make it appear on the mobile frontend only or reword
a few interface texts — you can maintain a `.patch.yml` in the plugin storage directory. The plugin
applies it **before** the features are loaded.

This file is **maintained by you only**: the plugin never creates a template, offers no entry in the
settings panel and does not watch it for changes. It adds no rows, buttons or notes to the panel.

## Where the file lives

```
<workspace>/data/storage/petal/some-settings-siyuan/.patch.yml
```

The file name is fixed and starts with a dot; it sits next to each feature's own `feature-<id>`
configuration file. A missing file simply means "no patch" — the normal state. The plugin does not
create it and says nothing about it.

## Fields

Feature declarations live under the top-level key `features`, grouped by **feature id**. Each feature may set one or
all of the five fields below. An omitted field keeps the declaration from the source; it does **not**
remove a restriction.

| Field           | Overrides                                        | Valid values                                                                                               |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `enabled`       | whether the feature ships with the plugin        | `true` / `false`                                                                                           |
| `category`      | the settings tab the feature lives in            | `ai` / `editor` / `doc-tree` / `appearance` / `connection` / `settings` / `bazaar` / `plugin`              |
| `frontends`     | the frontends it applies to                      | a list of `desktop` / `mobile`; `[]` means neither frontend; `null` or an empty value means no restriction |
| `minAppVersion` | the lowest supported SiYuan version (inclusive)  | a SiYuan version string such as `"3.8.7"`; `null` or an empty value removes the lower bound                |
| `maxAppVersion` | the highest supported SiYuan version (inclusive) | a SiYuan version string such as `"3.9.0"`; `null` or an empty value removes the upper bound                |

`category` takes the tab id, not the tab label. Quote version numbers: `3.8` is not a valid version,
`"3.8.7"` is.

## Example

```yaml
features:
  # Turn off "Send the agent message with Enter": its configuration is not loaded,
  # it is not mounted and it stays out of the settings panel by default
  agent-enter-to-send:
    enabled: false

  # Move it to the "Editor" tab and apply it to both frontends
  desktop-command-panel-slim:
    category: editor
    frontends: [desktop, mobile]

  # Try it only on your own SiYuan version
  tab-title-markdown:
    minAppVersion: "3.8.7"
    maxAppVersion: "3.9.0"

  # Remove both restrictions from the source, including the frontend one
  mobile-console-log:
    frontends: null
    maxAppVersion: null
```

A single feature may set several fields; the effects stack. `frontends` can also be written as a
block list:

```yaml
features:
  mobile-dock-blur:
    frontends:
      - mobile
```

## Removing a restriction

When the source already declares `maxAppVersion` (the patch retires once upstream implements the
feature), **omitting the field changes nothing** — the feature still hides itself on newer SiYuan
versions. To make it appear there you have to write the empty value explicitly:

```yaml
features:
  tab-title-markdown:
    maxAppVersion: null # `maxAppVersion:` means the same thing
```

The same applies to `minAppVersion` and `frontends`. Conversely, `frontends: []` means "neither
frontend", not "both" — use the empty list to stop a feature on your machine without touching
`enabled`.

## Overriding interface texts (i18n)

Besides the feature declarations the patch can override the texts that ship with the plugin, per
interface language. The top-level key is `i18n`, the second level is the language code and the third
level is the i18n key with its text:

```yaml
i18n:
  en:
    feature.clearConfig.action: "Clear everything"
    panel.unavailable.frontend: "Only available on {platform}"
```

* **Only the current interface language applies.** The plugin loads one language file at runtime (the
  one for the interface language), so a section for another language does not apply and raises no
  error; the language code may be written as `zh-CN` or with the legacy underscore `zh_CN`.
* **Only existing keys can be changed.** The key must already exist in the language file that ships
  with the plugin; a missing key is skipped (see the next subsection). Values are used verbatim:
  placeholders such as `{platform}`, `{version}` and `{count}` are still filled in by the code that
  uses the text, exactly as if the sentence had been written into `i18n/<language>.json` directly.

### Unknown feature ids and i18n keys

When a feature id or an i18n key named by the patch does not exist on this machine (a typo, or the
feature or text was removed by a plugin upgrade), that single entry is **skipped silently** and the
rest still applies. An old patch therefore survives an upgrade that removes a text; the downside is
that a typo produces no error at all — the `skipped unknown …` line in the detailed log is the only
clue.

## When it takes effect

* The file is read **when the plugin loads**, once. After editing it, disable and enable the plugin
  in "Settings → Marketplace → Downloaded → Some Settings", or reload the plugin; nothing watches the
  file.
* Text overrides are written into the language file the host already loaded before any feature is
  mounted, so the panel, the messages, the action buttons and every feature show the patched text,
  and the panel search matches it as well.
* The patch changes the **feature delivery declaration**, not the run switch inside each feature's
  panel. A feature turned off by `enabled: false` is not even loaded; a feature re-enabled by the
  patch still has to have its own switch turned on before it runs.
* Turning a feature off means the plugin does not ship it: its configuration is not loaded, it is not
  mounted and it stays out of the settings panel by default. With "Show unavailable settings" turned
  on in the "This plugin" tab, it is grayed in at the bottom of its own tab with the reason
  "Disabled by your patch".
* The patch can change the category: both the normal and the grayed entries move to the new tab, and
  the order inside the tab still follows the registration order.
* The patch can change the frontends and the version range; the reasons are recalculated from the
  patched declaration, so nothing from the source declaration lingers.

## What happens on errors

**Any single problem invalidates the whole file**: every feature falls back to the declaration that
ships with the plugin, and no partial state is ever applied. (The only exception is an unknown
feature id or i18n key: that entry is skipped, see above.) The reasons include:

* YAML syntax errors (the message carries a line number);
* a top-level key other than `features`, or `features` not being a "feature id → fields" mapping;
* an unknown field, a value of the wrong type;
* an `i18n` section that is not a "language → key → text" structure, a value that is not a string,
  or a key that the language file shipped with the plugin does not have;
* an invalid `category`, an invalid frontend, a duplicated frontend;
* an invalid version number, or a range that ends up empty because `minAppVersion` is above
  `maxAppVersion` after merging with the source declaration.

When that happens:

* the plugin starts as usual — settings entry, settings panel and every other feature keep working;
  a broken patch never blocks anything;
* with detailed logging turned on, the console shows one `WARN` with the reason (the file content is
  never echoed);
* after every successful opening of the plugin's settings panel a non-blocking message tells you the
  patch is invalid. The patch has no row in the panel, so without that message you would only find out
  by reading the console;
* a missing file, an empty file, a comments-only file and `features: {}` all mean "no override" and
  produce no error at all.

## Maintenance boundaries

* "Export configuration", "Import configuration" and "Clear this plugin's configuration" only touch
  the `feature-*` configuration files in the directory; they do **not** include `.patch.yml` and never
  modify it.
* Uninstalling the plugin deletes nothing in the plugin storage directory: `.patch.yml` and every
  feature's configuration stay in place and apply again after a reinstall.
* The panel and its search never show the patch itself: no row, no control, no path, no content, no
  status. The `i18n` section only overrides existing texts; it cannot add a key that nothing reads.

## Supported YAML

Only the syntax this file actually needs is accepted; anything else is an error rather than a guess:

* block mappings, indented with spaces only (two spaces per level is a good default);
* values: empty (`key:`, `null`, `~`), `true` / `false`, plain text, single- and double-quoted strings,
  inline lists `[a, b]`, the empty mapping `{}` and block lists (one `- a` per line);
* comments: a whole line `# …`, or `# …` after a value separated by whitespace (a `#` inside quotes
  is not a comment).

Not supported: anchors and aliases (`&` / `*`), multiple documents (`---`), block scalars (`|` / `>`),
inline mappings other than `{}`, tags (`!!`), tab indentation, and the ambiguous booleans
`yes` / `no` / `on` / `off` — write `true` / `false` instead.

> The patch is an advanced entry point: the plugin does not promise that a feature forced on, or one
> whose frontends and version limits you changed, will work correctly.
