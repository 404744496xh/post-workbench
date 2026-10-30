import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/vditor/dist");
const target = resolve(root, "public/vditor/dist");

const files = [
  "js/lute/lute.min.js",
  "js/i18n/zh_CN.js",
  "js/icons/ant.js",
  "js/highlight.js/highlight.min.js",
  "js/highlight.js/third-languages.js",
  "js/highlight.js/styles/github.min.css",
  "js/highlight.js/styles/github-dark.min.css",
  "css/content-theme/light.css",
  "css/content-theme/dark.css",
  "js/katex/katex.min.js",
  "js/katex/katex.min.css",
  "js/katex/mhchem.min.js",
];

// 先清掉上一次的产物，否则旧字体不会随构建消失
rmSync(resolve(target, "js/katex"), { recursive: true, force: true });

for (const file of files) {
  const from = resolve(source, file);
  const to = resolve(target, file);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

// katex.min.css 里 woff2 排在最前，主流浏览器都支持，不再打包 ttf/woff
const fontsSource = resolve(source, "js/katex/fonts");
const fontsTarget = resolve(target, "js/katex/fonts");
mkdirSync(fontsTarget, { recursive: true });
for (const font of readdirSync(fontsSource)) {
  if (font.endsWith(".woff2")) {
    cpSync(resolve(fontsSource, font), resolve(fontsTarget, font));
  }
}
