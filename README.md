[中文](README.zh-CN.md)

# Some Settings

> A batch of **independently toggleable** SiYuan enhancements — every setting item can be enabled, disabled or hidden on its own.

* Minimum SiYuan version: `3.8.6-alpha.4`
* Environments: desktop, mobile, desktop window, browser; any backend
* The plugin is disabled in read-only / publish mode

## Getting started

Open **Settings → Marketplace → Downloaded → Some Settings → Settings**. That is the only entry point — the plugin
adds no top bar button, no status bar item and no dock item.

Every item in the panel starts with a switch and is **off by default**; turn on the ones you want.
Click **Save** when you are done, or **Cancel** to discard everything — closing with unsaved changes asks first.
Switching a feature off unmounts it **completely** (styles, listeners and injected nodes are all released) with no
plugin reload, and a feature that only works on one frontend never appears in the panel on the other one.

## Features

### Functionality

| Setting                                                 | Applies to | What it does                                                                                                                             |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Never remember the code language                        | both       | New code blocks always start with an empty language instead of reusing the last one picked                                               |
| Create the daily note directly                          | both       | Creates the daily note in the chosen notebook without asking; creation still runs through SiYuan's own code                              |
| Fixed first document icon                               | both       | Uses a configured emoji the first time a document gets an icon instead of a random one                                                   |
| Confirm before opening a web link                       | both       | Asks before opening an http/https link and shows the full original URL                                                                   |
| Reconnect button on the disconnect panel (experimental) | both       | Adds a _Reconnect now_ button to the kernel-disconnected panel                                                                           |
| Automatic reconnect after a disconnect (experimental)   | both       | Probes the kernel on its own schedule while disconnected and reloads as soon as it answers (2 × 500ms by default)                        |
| DeepSeek balance in the agent panel                     | both       | Shows the account balance centred below the agent panel composer while the official api.deepseek.com DeepSeek model is in use            |
| File size and metadata in the asset menu                | both       | File size, image dimensions, type and modified time for a workspace asset, in the menu of an image or of an audio/video/iframe block     |
| Jump to the last position when a bookmark opens a note  | both       | Opens a whole-document bookmark through the document tree's own path, restoring the last reading position                                |
| A floating window instead of the recording notice       | both       | Replaces the recording notice with a small floating window showing the elapsed time, with a stop button (SiYuan's recorder has no pause) |
| Ask before quitting                                     | both       | Asks before SiYuan quits (the main menu's Quit and close-to-quit); a tray quit does not ask (disabled / desktop / mobile / both)         |

### Interface

| Setting                                                    | Applies to | What it does                                                                                                                                        |
| ---------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blur behind modals                                         | both       | Backdrop blur behind dialogs, so the editor underneath softens while the dialog stays sharp                                                         |
| Accent for the opened note                                 | both       | Flush accent bar on the left edge of the opened note in the document tree, with a custom colour                                                     |
| Inline Markdown in document tree titles                    | both       | Renders inline Markdown in notebook and document titles of the document tree with SiYuan's own inline styles                                        |
| Heading level in the title icon                            | both       | Uses SiYuan's own H1-H6 icons in the reference list and the search panel, so a heading block shows its level                                        |
| Copy button for inline code                                | both       | Copy button for inline code wherever it is rendered: off, on hover (recommended), or always                                                         |
| Syntax highlighting for snippets                           | both       | Colours the snippet editor using SiYuan's own highlight.js and current code theme                                                                   |
| Slimmer desktop command panel                              | desktop    | Shrinks the command panel to a share of SiYuan's native width (50% by default)                                                                      |
| Blur behind the mobile dock bar                            | mobile     | Backdrop blur behind the floating mobile dock bar                                                                                                   |
| Smoother mobile bars                                       | mobile     | Smooth transition for the top bar, breadcrumb and dock bar show/hide; the dock bar only shows or hides as a whole                                   |
| Taller mobile candidate panel                              | mobile     | Taller mobile candidate panel (including reference search), never past the visible area                                                             |
| Always show Sync on mobile                                 | mobile     | Keeps Sync visible in the top-right corner; the click stays SiYuan's own sync guide                                                                 |
| Native SiYuan style for mobile dropdowns                   | mobile     | Dropdowns use SiYuan's own menu instead of the WebView picker                                                                                       |
| Labels in the mobile long-press menu                       | mobile     | Adds text to the icon-only buttons in the mobile long-press menu (the back button stays an icon)                                                    |
| Keep the block icon visible on mobile                      | mobile     | Keeps the operated block's icon visible instead of letting it flicker                                                                               |
| Hide the mobile Quit button                                | mobile     | Hides the icon-only Quit button in the mobile side panel                                                                                            |
| Do not focus the first control when a settings panel opens | both       | Keeps a settings panel from focusing its first control when it opens: this plugin's panel and SiYuan's own settings dialog                          |
| Inline Markdown in tab titles                              | both       | Renders inline Markdown in tab titles: the desktop tab bar with its dropdown list, and the mobile tab overview (disabled / desktop / mobile / both) |
| Guide to the Ref Crumbs plugin                             | both       | A pointer to Ref Crumbs, another plugin by the same author, with a button that opens its settings panel or its marketplace page                     |

### Development

| Setting                                       | Applies to | What it does                                                                                             |
| --------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| F12 toggles the developer tools               | desktop    | Opens or closes the developer tools with F12, the same entry as the one in the status bar context menu   |
| Console log viewer                            | mobile     | Collects console output from the moment the plugin loads and shows the full log, with copy-all and clear |
| Clear this plugin's configuration             | both       | Wipes every configuration file the plugin wrote and reloads the frontend, back to a just-installed state |
| About this plugin                             | both       | A read-only notice: what the plugin is, the current version and the GitHub repository                    |
| Import and export this plugin's configuration | both       | Exports every setting as one JSON document, and writes such a document back (only the items it contains) |

## Notes

* Saving is **per panel**: nothing is written until you click **Save**, and **Cancel** writes nothing (closing with
  unsaved changes asks first). There is no per-item reset button — to restore one item, export the configuration,
  edit it and import it again, or use _Clear this plugin's configuration_ to wipe everything.
* **"Reconnect now" means reloading the frontend.** SiYuan gives plugins no way to rebuild the main WebSocket, so both
  reconnect features reload the whole page once the kernel answers again. Note content always lives in the kernel and
  is written as you go, so a reload never loses a document.
* The console log viewer only starts collecting once its switch is on, so the logs from plugin startup and from before
  you flipped the switch are not recorded. Turn it on and reproduce the problem.
* The inline-code copy button's "on hover" mode follows the **caret** on mobile (there is no hover with a finger): the
  button appears as soon as the caret or a selection lands inside an inline code span. Clicking it does not steal
  focus from the editor — the keyboard and the caret stay where they were.
* Inline Markdown in tab and document tree titles only **hides** the syntax characters in the DOM; the title text
  itself is unchanged, so everything that reads it verbatim (drag hints, `document.title`, the unlock prompt of an
  encrypted notebook) still gets the original. Turning the feature off restores the plain title.
* Jump-to-last-position only takes over whole-document bookmarks opened with a plain left click;
  modified clicks keep SiYuan's own behaviour (new tab, split, keep cursor), and bookmarks on a block are untouched.
* Ask-before-quitting covers the main menu's Quit and closing the window when SiYuan is set to quit on close. A tray
  quit does not ask; quitting while connected to a **remote kernel**, and the host's own fallback quit when the request
  fails, cannot be reached by any plugin API.
* The recording window only replaces the UI. Permission handling, MP3 encoding, upload and inserting the audio block
  all stay SiYuan's own code, and SiYuan's recorder has no pause, so the window offers stop only.
* Native-style mobile dropdowns are best-effort: on some kernel/platform combinations the system picker still opens,
  in which case the select behaves exactly as it does without the plugin.
* Asset rows land directly in the context menu, next to SiYuan's own _Modified_ / _Created_ rows and after a
  separator, rather than inside the **Plugin** submenu. Only workspace assets (`assets/…`) have a file size and a
  modified time — external URLs and `data:` URIs do not.
* Do-not-focus-the-first-control keeps the focus on the dialog itself until you click a control (or its label, or a
  button) or press a key, so the very first keystroke goes nowhere and the mobile keyboard stays down — that is what
  the switch is for, not a bug. Clicking only the title bar or a sidebar category does not count as interacting.
* Fixed first document icon writes the document's `icon` attribute and refreshes the title area, the document tree,
  pinned rows and the outline in place.
* Syntax highlighting for snippets depends on SiYuan's own highlight.js. If that never loads, the plugin tears the
  highlight layer down and leaves the editor as plain text rather than leaving an unreadable input.
* The repository link in _About this plugin_ goes through the link confirmation like any other external link.
* Importing a configuration reloads the frontend: the panel still holds the drafts from before the import, so **do not
  click Save afterwards**, or those older values are written back.
* The Ref Crumbs guide opens that plugin's marketplace page when it is not installed; with the marketplace disabled on
  the device it only reports that.

## License

[MIT](./LICENSE)
