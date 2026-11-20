# Third-party notices

This document lists third-party material that is **distributed with this plugin** and the
third-party tools used to build or test it. It does not replace any license text; the rights in
each component remain with its respective owner.

The plugin itself is licensed under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later); see [LICENSE](./LICENSE).

## Distributed third-party material

| Material | Location | License | Copyright | Notes |
| --- | --- | --- | --- | --- |
| SiYuan sponsor icon (`Constants.SIYUAN_IMAGE_SPONSOR`, 32×32 gradient heart) | `src/features/plugin-reminder/links.ts` (`DONATE_ICON`) | AGPL-3.0 | © siyuan-note and SiYuan contributors | Copied verbatim so the plugin's "donate" button matches the one on SiYuan's About page. This is the reason the whole plugin is AGPL-3.0-or-later rather than a permissive license. |
| SiYuan daylight theme values used by the README preview mock-up | `assets/preview.html` → `assets/preview.png` | AGPL-3.0 | © siyuan-note and SiYuan contributors | The preview reproduces SiYuan's settings UI; its `--b3-*` custom property values are taken from `app/appearance/themes/daylight/theme.css`. The image is documentation only and is not loaded at runtime. |

The plugin does not embed any other third-party code, fonts, icons, or data. Everything else in
`src/`, `assets/` and the built `package.zip` is original work of this repository's author.

## Host-provided API

The `siyuan` npm package is used for type declarations only. It is marked external in the build
and is injected by SiYuan at runtime, so no part of it is redistributed inside this plugin.

## Build and test tooling (not distributed)

These packages run on the developer's machine or in CI. Their output is bundled only as ordinary
compiled JavaScript authored by this repository; none of their own runtime code is shipped inside
`package.zip`.

| Package | Version | License |
| --- | --- | --- |
| `vite` | 8.x | MIT |
| `typescript` | 6.x | Apache-2.0 |
| `eslint` | 10.x | MIT |
| `dprint` | 0.57.x | MIT |
| `vitest` / `@vitest/coverage-v8` | 5.x | MIT |
| `jsdom` | 31.x | MIT |
| `sharp` | 0.35.x | Apache-2.0 |
| `playwright` | 1.x | Apache-2.0 |
| `sass` | 1.x | MIT |
| `fflate` | 0.8.x | MIT |

Exact versions are pinned in `package-lock.json`.

## Trademarks

"SiYuan" and "思源笔记" are names of the SiYuan note-taking application and its project. This
plugin is an unofficial community plugin. It is not affiliated with, endorsed by, or maintained by
the SiYuan project.

## Reporting a licensing problem

If you believe this repository redistributes material without the required permission or notice,
please open an issue at <https://github.com/wmy2981/some-settings-siyuan/issues> so it can be
corrected.
