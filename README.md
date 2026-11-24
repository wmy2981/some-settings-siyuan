[简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

# Some Settings

> A batch of **independently toggleable** SiYuan enhancements — every setting item can be enabled or disabled on its own.

Feedback and feature suggestions are welcome — please [open an issue](https://github.com/wmy2981/some-settings-siyuan/issues/new/choose).

## Features

Categories follow the native SiYuan feature each setting affects, and match the tabs of the settings panel.

### AI

* DeepSeek balance in the agent panel
* Send the agent message with Enter
* Hide the agent's suggested prompts
* Pin the agent thinking header
* Details for the agent's tool calls
* Translate agent thinking

### Editor

* Never remember the code language
* Confirm before opening a web link
* File size and metadata in the asset menu
* Create a file in assets from the slash menu
* A floating window instead of the recording notice
* Heading level in the title icon
* Copy button for inline code
* Hide the selection toolbar

### Document tree

* Fixed first document icon
* Jump to the last position when a bookmark opens a note
* Accent for the opened note
* Inline Markdown in document tree titles
* Inline Markdown in tab titles
* Close idle tabs
* Outline heading level limit
* Mobile document tree title size back to 3.8.9
* Create the daily note directly
* Create new documents at a fixed location

### Appearance

* Blur behind modals
* Keep the exit screen blurred
* Slimmer desktop command panel
* Blur behind the mobile dock bar
* Smoother mobile bars
* Taller mobile candidate panel
* Mobile drawers fit their content
* Always show Sync on mobile
* Native SiYuan style for mobile dropdowns
* Labels in the mobile long-press menu
* Keep the block icon visible on mobile
* Hide the mobile Quit button

### Connection

* Reconnect button on the disconnect panel
* Automatic reconnect after a disconnect

### Settings

* Ask before quitting
* Aliyun OSS bucket usage
* Syntax highlighting for snippets
* F12 toggles the developer tools
* Console log viewer

### Marketplace

* Custom marketplace icons
* Block marketplace packages by author
* Hide downloaded donation buttons

### This plugin

* Detailed log output
* Show unavailable settings
* Settings panel search
* Clear this plugin's configuration
* About this plugin
* Import and export this plugin's configuration

## Installation

1. **SiYuan marketplace** — open **Settings → Marketplace**, find _Some Settings_ and install it; later updates
   arrive the same way.
2. **Release download** — download `package.zip` from the
   [releases](https://github.com/wmy2981/some-settings-siyuan/releases) and unzip it into
   `<workspace>/data/plugins/some-settings-siyuan/`, so `plugin.json` sits directly in that folder; then restart
   SiYuan.
3. **Build from source** — clone the repository, run `npm install` and then `npm run build` (Node 24 or newer); the
   build writes `package.zip` and a flat `dist/`, unzip either into the same folder.

Then open **Settings → Marketplace → Downloaded → Some Settings → Settings**. That is the only entry point — the
plugin adds no top bar button, no status bar item and no dock item. The panel follows your own
**Open settings in a separate window** setting: a separate window when it is on, the usual dialog when it is off.

## Advanced Use

See [User-level declaration patch: `.patch.yml`](docs/patch.md) for overriding feature declarations and interface texts on your own machine.

## Bazaar Stats Graph

![Bazaar stats graph](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/some-settings-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=en)

## Development

Requires Node.js 24 or newer. After cloning the repository:

```bash
npm ci              # install dependencies
npm run dev         # watch sources, write index.js / index.css / i18n into the repository root
npm run build       # check the feature declarations, then build dist/ and package.zip
npm run check       # check the feature declarations and the three language files only
npm run typecheck   # TypeScript typecheck
npm run lint        # ESLint
npm run format      # format with dprint (format:check only verifies)
npm test            # unit tests (vitest)
```

## License

[AGPL-3.0-or-later](./LICENSE)

Third-party material shipped with the plugin, and the tools used to build and test it, are listed in [third-party notices](./THIRD_PARTY_NOTICES.md).
