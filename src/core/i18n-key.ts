/**
 * i18n 键名的机械推导。
 *
 * 全插件的键名只有五组前缀：`plugin.` / `category.` / `panel.` / `common.` / `feature.`，
 * 其中只有「分类」这一组需要在运行期拼出来（`category.<分类 id 转驼峰>`），其余全是字面量。
 * 分类 id 本身仍是 kebab（`core/types.ts` 的 `FeatureCategory`），转换规则放在这里，
 * `scripts/check-features.mjs` 里有一份同规则的副本（脚本跑在裸 node 上，import 不到 TS），
 * 两边不一致会直接表现为「键缺失」，由 `npm run check` 拦下。
 */
import type {FeatureCategory} from "./types";

/** `doc-tree` → `docTree`：按 `-` 切分，首段原样，后续段首字母大写。 */
export const camelId = (id: string): string =>
    id.split("-").map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join("");

/** 分类页签的文案 key。 */
export const categoryKey = (category: FeatureCategory): string => `category.${camelId(category)}`;
