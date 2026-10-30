import { cpSync, mkdirSync } from "node:fs";
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
];

for (const file of files) {
  const from = resolve(source, file);
  const to = resolve(target, file);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

cpSync(resolve(source, "js/katex"), resolve(target, "js/katex"), {
  recursive: true,
});
