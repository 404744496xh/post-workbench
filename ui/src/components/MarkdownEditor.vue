<script setup lang="ts">
import type { Attachment } from "@halo-dev/api-client";
import type { AxiosRequestConfig } from "axios";
import Vditor from "vditor";
import "vditor/dist/index.css";
import { h, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { Component } from "vue";
import { MERMAID_SCRIPT_ID, MERMAID_SRC } from "../mermaidAsset";
import { applyMermaidTheme } from "../mermaidTheme";
import ContextMenu from "./ContextMenu.vue";
import type { MenuItem } from "../types";

const props = withDefaults(
  defineProps<{
    title?: string;
    raw?: string;
    content?: string;
    cover?: string;
    uploadImage?: (file: File, options?: AxiosRequestConfig) => Promise<Attachment>;
    upload?: (file: File, options?: AxiosRequestConfig) => Promise<Attachment>;
    matchAttachmentPermalinks?: (urls: string[]) => Promise<string[]>;
  }>(),
  {
    title: "",
    raw: "",
    content: "",
    cover: undefined,
    uploadImage: undefined,
    upload: undefined,
    matchAttachmentPermalinks: undefined,
  },
);

const emit = defineEmits<{
  (event: "update:title", value: string): void;
  (event: "update:raw", value: string): void;
  (event: "update:content", value: string): void;
  (event: "update", value: string): void;
  (event: "update:cover", value: string | undefined): void;
}>();

const CDN = "/plugins/post-workbench/assets/ui/vditor";
const CONTENT_THEME_PATH = `${CDN}/dist/css/content-theme`;

// Vditor 自己请求的是 mermaid.min.js?v=11.17.2，这个地址在加上 mermaid 支持前可能
// 已经被浏览器按 404 缓存过（Halo 的 404 带 max-age），所以这里用带自建版本号的地址
// 先加载一次：script 的 id 与 Vditor 内部一致，它检测到后不会再发自己的请求。
const mermaidWindow = () => window as unknown as { mermaid?: unknown };

function ensureMermaid(): Promise<boolean> {
  if (mermaidWindow().mermaid) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let script = document.getElementById(MERMAID_SCRIPT_ID) as HTMLScriptElement | null;
    const done = () => resolve(!!mermaidWindow().mermaid);
    if (script) {
      if (script.dataset.loaded === "1") {
        done();
        return;
      }
      script.addEventListener("load", done, { once: true });
      script.addEventListener("error", done, { once: true });
      return;
    }
    script = document.createElement("script");
    script.id = MERMAID_SCRIPT_ID;
    script.src = MERMAID_SRC;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        (script as HTMLScriptElement).dataset.loaded = "1";
        done();
      },
      { once: true },
    );
    script.addEventListener("error", done, { once: true });
    document.head.appendChild(script);
  });
}

// 深浅色切换后需要按新配色重绘。Vditor 渲染后预览区里只剩 SVG，
// 但同一代码块前面的源码块仍保留 Markdown 原文，用它回填后再渲染。
// 注意只能渲染预览区：对整个 IR 区域调用会把源码块也替换成 SVG。
async function renderMermaidBlocks() {
  const instance = vditor.value;
  if (!instance) {
    return;
  }
  const previews = Array.from(
    instance.vditor.ir.element.querySelectorAll(".vditor-ir__preview"),
  ).filter((preview) => preview.querySelector(".language-mermaid"));
  if (previews.length === 0) {
    return;
  }
  const loaded = await ensureMermaid();
  if (!loaded) {
    return;
  }
  applyMermaidTheme();
  previews.forEach((preview) => {
    const item = preview.querySelector<HTMLElement>(".language-mermaid");
    const source = preview.previousElementSibling?.querySelector(
      "code.language-mermaid",
    )?.textContent;
    if (!item || !source) {
      return;
    }
    item.textContent = source;
    item.removeAttribute("data-processed");
    Vditor.mermaidRender(preview, CDN, instance.vditor.options.theme);
  });
}

const editorEl = ref<HTMLDivElement>();
const titleEl = ref<HTMLInputElement>();
const hostEl = ref<HTMLDivElement>();
const vditor = shallowRef<Vditor>();
const ready = ref(false);

// 块左侧的「+ / 拖拽柄」与编辑器右键菜单
const GUTTER_WIDTH = 48;
const gutterBlock = shallowRef<HTMLElement | null>(null);
const gutterPos = ref({ left: 0, top: 0, width: GUTTER_WIDTH, compact: false });
const dropLine = ref<{ top: number; left: number; width: number } | null>(null);
const menuOpen = ref(false);
const menuPos = ref({ x: 0, y: 0 });
const menuItems = ref<MenuItem[]>([]);
let menuActions: Record<string, () => void> = {};
let draggingBlock: HTMLElement | null = null;
let dropTarget: { block: HTMLElement; after: boolean } | null = null;
let gutterTimer: number | undefined;
let dragStart: { x: number; y: number } | null = null;
let dragActive = false;
let suppressHandleClick = false;

const ICON_PATHS = {
  text: ["M3.5 3.5h9", "M8 3.5v9", "M5.5 12.5h5"],
  title: ["M3.5 4h9", "M8 4v8"],
  plus: ["M8 3v10", "M3 8h10"],
  list: ["M3 4.5h2M7 4.5h6", "M3 8h2M7 8h6", "M3 11.5h2M7 11.5h6"],
  ordered: [
    "M3 3.5h1.2v3",
    "M2.8 6.5h1.6",
    "M3 9.5c.2-.6.8-1 1.4-.8.8.1 1.2.9.9 1.6L2.8 12.5h2.4",
    "M7 4.5h6",
    "M7 8h6",
    "M7 11.5h6",
  ],
  check: ["M3 4.5h10", "M3 8h10", "M3 11.5h6"],
  quote: [
    "M3.5 5.5h2.5v2.5H3.5z",
    "M3.5 8c0 1.6.8 2.5 2 3",
    "M9.5 5.5H12v2.5H9.5z",
    "M9.5 8c0 1.6.8 2.5 2 3",
  ],
  code: ["M6 5L3.5 8 6 11", "M10 5l2.5 3L10 11"],
  table: ["M2.5 3.5h11v9h-11z", "M2.5 6.5h11M2.5 9.5h11", "M6 3.5v9M10 3.5v9"],
  line: ["M2.5 8h11"],
  copy: [
    "M5.5 5.5h8v8h-8z",
    "M10.5 5.5v-1a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h1",
  ],
  top: ["M8 12.5v-9", "M4.5 7L8 3.5 11.5 7", "M3.5 13.5h9"],
  move: ["M2.5 5.5h4l1.2 1.5h5.8v5.5h-11z", "M8 8.5h4", "M10.2 6.7L12 8.5l-1.8 1.8"],
  trash: ["M2.5 4.5h11", "M6.5 4.5V3h3v1.5", "M4 4.5l.6 8.5h6.8l.6-8.5"],
  bold: ["M5 3h3.2a2.3 2.3 0 010 4.6H5z", "M5 7.6h3.8a2.4 2.4 0 010 4.8H5z"],
  italic: ["M6.5 3.5h4", "M5.5 12.5h4", "M9.2 3.5L6.8 12.5"],
  strike: [
    "M3.5 8h9",
    "M5.2 5.4A2.5 2.5 0 017.6 3.5h1.2a2.2 2.2 0 012 1.1",
    "M10.8 10.6a2.5 2.5 0 01-2.4 1.9H7.2a2.2 2.2 0 01-2-1.1",
  ],
  link: [
    "M6.5 9.5l3-3",
    "M7.5 4.5l1-1a2.1 2.1 0 013 3l-1 1",
    "M8.5 11.5l-1 1a2.1 2.1 0 01-3-3l1-1",
  ],
  undo: ["M3.5 7a4.5 4.5 0 1 1 1.4 4.3", "M3.5 3.5V7H7"],
  redo: ["M12.5 6.5A4.5 4.5 0 113.5 9", "M12.5 3.5v3h-3"],
} as const;

type MenuIconName = keyof typeof ICON_PATHS;

const menuIcons = Object.fromEntries(
  (Object.keys(ICON_PATHS) as MenuIconName[]).map((name) => {
    const paths = ICON_PATHS[name];
    return [
      name,
      markRaw({
        name: `WbIcon${name}`,
        render: () =>
          h(
            "svg",
            { viewBox: "0 0 16 16", fill: "none" },
            paths.map((d) =>
              h("path", {
                d,
                stroke: "currentColor",
                "stroke-width": 1.4,
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
              }),
            ),
          ),
      }),
    ];
  }),
) as Record<MenuIconName, Component>;

// 与富文本编辑器共用同一个折叠偏好
const OUTLINE_KEY = "post-workbench:outline-hidden";
const outlineHidden = ref(localStorage.getItem(OUTLINE_KEY) === "1");
const outlineAvailable = ref(false);
const panelOpen = ref(false);
const outlineFlyout = ref(false);
const headings = ref<{ level: number; text: string; id: string }[]>([]);

let contentTimer: number | undefined;
let flyoutTimer: number | undefined;
let inlineHtmlTimer: number | undefined;

function isDark() {
  const root = document.documentElement;
  return (
    root.classList.contains("dark") ||
    root.dataset.theme === "dark" ||
    document.body.classList.contains("dark")
  );
}

// Vditor 渲染大纲时会重写标题 id，因此必须在渲染之后读取标题列表
function collectHeadings() {
  const instance = vditor.value;
  if (!instance) {
    return;
  }
  instance.vditor.outline.render(instance.vditor);
  const items = instance.vditor.outline.element.querySelectorAll<HTMLElement>(
    "[data-target-id]",
  );
  const list: { level: number; text: string; id: string }[] = [];
  items.forEach((item) => {
    const id = item.getAttribute("data-target-id") || "";
    const heading = document.getElementById(id);
    if (!heading) {
      return;
    }
    list.push({
      level: Math.min(4, Math.max(1, Number(heading.tagName.charAt(1)) || 1)),
      text: (item.textContent || "").trim(),
      id,
    });
  });
  headings.value = list;
  outlineAvailable.value = list.length > 0;
}

function applyOutline() {
  const instance = vditor.value;
  if (!instance) {
    return;
  }
  instance.vditor.outline.toggle(
    instance.vditor,
    !outlineHidden.value && outlineAvailable.value,
    false,
  );
  // 窄屏下 Vditor 会拒绝展开面板，此时一律用折叠轨道
  panelOpen.value =
    instance.vditor.outline.element.style.display !== "none";
}

function syncOutline() {
  collectHeadings();
  applyOutline();
}

function scrollToHeading(id: string) {
  const heading = document.getElementById(id);
  // Vditor 只设置 .vditor-ir 的 scrollTop，而真正的滚动容器是内部的 .vditor-reset
  const scroller = editorEl.value?.querySelector<HTMLElement>(
    ".vditor-ir .vditor-reset",
  );
  if (!heading || !scroller) {
    return;
  }
  const delta =
    heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
}

function onOutlineClick(event: MouseEvent) {
  const item = (event.target as HTMLElement).closest?.("[data-target-id]");
  const id = item?.getAttribute("data-target-id");
  if (!id) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  scrollToHeading(id);
}

function setOutlineHidden(hidden: boolean) {
  outlineHidden.value = hidden;
  if (hidden) {
    hideFlyout();
  }
}

function showFlyout() {
  window.clearTimeout(flyoutTimer);
  outlineFlyout.value = true;
}

function hideFlyout() {
  window.clearTimeout(flyoutTimer);
  flyoutTimer = window.setTimeout(() => {
    outlineFlyout.value = false;
  }, 160);
}

function jump(index: number) {
  const heading = headings.value[index];
  if (heading) {
    scrollToHeading(heading.id);
  }
}

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

function headingKey(element: Element) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

// Vditor 渲染的标题不带 id，直接回写会抹掉 Halo 服务端生成的锚点，前台目录和 #permalink 一起失效。
// 按标题文本把原有 id / tabindex 搬回来；同名标题用队列按出现顺序配对。
function headingIdMap(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const map = new Map<string, { id: string; tabindex: string | null }[]>();
  doc.body.querySelectorAll(HEADING_SELECTOR).forEach((element) => {
    const id = element.getAttribute("id");
    if (!id) {
      return;
    }
    const key = headingKey(element);
    const bucket = map.get(key) ?? [];
    bucket.push({ id, tabindex: element.getAttribute("tabindex") });
    map.set(key, bucket);
  });
  return map;
}

function withHeadingIds(html: string) {
  if (!props.content) {
    return html;
  }
  const map = headingIdMap(props.content);
  if (map.size === 0) {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll(HEADING_SELECTOR).forEach((element) => {
    if (element.getAttribute("id")) {
      return;
    }
    const next = map.get(headingKey(element))?.shift();
    if (!next) {
      return;
    }
    element.setAttribute("id", next.id);
    if (next.tabindex !== null) {
      element.setAttribute("tabindex", next.tabindex);
    }
  });
  return doc.body.innerHTML;
}

function flushContent() {
  window.clearTimeout(contentTimer);
  if (!vditor.value) {
    return;
  }
  syncOutline();
  emit("update:content", withHeadingIds(vditor.value.getHTML()));
}

function flushAll() {
  window.clearTimeout(contentTimer);
  if (!vditor.value) {
    return;
  }
  const raw = vditor.value.getValue();
  syncOutline();
  emit("update:raw", raw);
  emit("update", raw);
  emit("update:content", withHeadingIds(vditor.value.getHTML()));
}

// lute 在 IR 模式下只给 html-block 生成预览，行内的空元素（<img> 等）会被压成 0 尺寸
// 的 marker，编辑器里什么都不显示。这里补一个 data-render 预览节点：lute 回读 Markdown
// 时会整棵跳过带 data-render 的元素，因此不影响 getValue() 的源码。
const INLINE_TAGS: Record<string, string[]> = {
  img: ["src", "alt", "title", "width", "height", "loading"],
  hr: [],
  br: [],
  wbr: [],
};

function isSafeUrl(value: string) {
  const url = value.trim().toLowerCase();
  if (url.startsWith("data:")) {
    return url.startsWith("data:image/");
  }
  return !/^(javascript|vbscript|file):/.test(url);
}

function renderInlineHtml() {
  const root = editorEl.value?.querySelector<HTMLElement>(".vditor-ir");
  if (!root) {
    return;
  }
  const selection = window.getSelection();
  root
    .querySelectorAll<HTMLElement>('[data-type="html-inline"]')
    .forEach((node) => {
      if (node.querySelector(".vditor-ir__preview")) {
        return;
      }
      // 正在编辑的节点不插入，避免抢走光标
      if (selection?.anchorNode && node.contains(selection.anchorNode)) {
        return;
      }
      const source = node.querySelector("code")?.textContent?.trim() ?? "";
      const matched = /^<([a-zA-Z][\w-]*)\b([^>]*)\/?>$/.exec(source);
      if (!matched) {
        return;
      }
      const tag = matched[1].toLowerCase();
      const allowed = INLINE_TAGS[tag];
      if (!allowed) {
        return;
      }
      const element = document.createElement(tag);
      const attrs = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attr: RegExpExecArray | null;
      while ((attr = attrs.exec(matched[2]))) {
        const name = attr[1].toLowerCase();
        const value = attr[3] ?? attr[2] ?? "";
        if (!allowed.includes(name)) {
          continue;
        }
        if (name === "src" && !isSafeUrl(value)) {
          return;
        }
        element.setAttribute(name, value);
      }
      const preview = document.createElement("span");
      preview.className = "vditor-ir__preview";
      preview.setAttribute("data-render", "1");
      preview.setAttribute("contenteditable", "false");
      preview.appendChild(element);
      node.appendChild(preview);
    });
}

function scheduleInlineHtml() {
  window.clearTimeout(inlineHtmlTimer);
  inlineHtmlTimer = window.setTimeout(renderInlineHtml, 0);
}

let mermaidPreparing = false;

function onInput(value: string) {
  scheduleInlineHtml();
  emit("update:raw", value);
  emit("update", value);
  window.clearTimeout(contentTimer);
  contentTimer = window.setTimeout(flushContent, 350);
  // 新输入的 mermaid 块可能比配色补丁先渲染，补齐后再按源码重绘一遍
  if (value.includes("```mermaid") && !mermaidPreparing) {
    mermaidPreparing = true;
    void ensureMermaid().then(() => {
      applyMermaidTheme();
      void renderMermaidBlocks();
    });
  }
}

function onTitleInput(event: Event) {
  emit("update:title", (event.target as HTMLInputElement).value);
}

function focusEditor() {
  vditor.value?.focus();
}

function runToolbarAction(name: string) {
  vditor.value?.focus();
  vditor.value?.vditor.toolbar?.elements?.[name]
    ?.querySelector<HTMLElement>("button")
    ?.click();
}

function editorReset() {
  return (
    editorEl.value?.querySelector<HTMLElement>(".vditor-ir .vditor-reset") ??
    null
  );
}

function topBlockOf(node: Node | null) {
  const reset = editorReset();
  if (!reset || !node) {
    return null;
  }
  let element: Element | null =
    node instanceof Element ? node : node.parentElement;
  while (element && element.parentElement !== reset) {
    element = element.parentElement;
  }
  return element instanceof HTMLElement && element.parentElement === reset
    ? element
    : null;
}

function positionGutter(block: HTMLElement) {
  const host = hostEl.value;
  if (!host) {
    return;
  }
  const hostRect = host.getBoundingClientRect();
  const rect = block.getBoundingClientRect();
  if (rect.bottom < hostRect.top + 2 || rect.top > hostRect.bottom - 2) {
    gutterBlock.value = null;
    return;
  }
  // 写作台的正文栏离左缘很近：放得下 48px 用双按钮，否则收成 34px 紧凑手柄
  const available = rect.left - hostRect.left - 2;
  if (available < 34) {
    gutterBlock.value = null;
    return;
  }
  const compact = available < GUTTER_WIDTH;
  const width = compact ? 34 : GUTTER_WIDTH;
  gutterPos.value = {
    left: available - width,
    top: Math.max(2, rect.top - hostRect.top + 2),
    width,
    compact,
  };
}

function cancelGutterHide() {
  window.clearTimeout(gutterTimer);
}

function scheduleGutterHide() {
  cancelGutterHide();
  gutterTimer = window.setTimeout(() => {
    if (!draggingBlock) {
      gutterBlock.value = null;
    }
  }, 220);
}

function hideGutterNow() {
  cancelGutterHide();
  gutterBlock.value = null;
}

function onEditorMouseMove(event: MouseEvent) {
  if (draggingBlock) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(".wb-block-gutter")) {
    cancelGutterHide();
    return;
  }
  const block = topBlockOf(target);
  if (!block) {
    scheduleGutterHide();
    return;
  }
  cancelGutterHide();
  gutterBlock.value = block;
  positionGutter(block);
}

function setBlockCaret(block: HTMLElement, edge: "start" | "end") {
  vditor.value?.focus();
  const range = document.createRange();
  range.selectNodeContents(block);
  range.collapse(edge === "start");
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretRangeAt(event: MouseEvent) {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) {
    return doc.caretRangeFromPoint(event.clientX, event.clientY);
  }
  const position = doc.caretPositionFromPoint?.(
    event.clientX,
    event.clientY,
  );
  if (!position) {
    return null;
  }
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

// 直接移动/删除块后，借 Vditor 自己的 preventInput 通道同步 markdown 与撤销栈
function syncDomChange() {
  const internal = vditor.value?.vditor;
  if (!internal?.ir) {
    return;
  }
  internal.ir.preventInput = true;
  internal.ir.element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertReorderedContent",
    }),
  );
}

type InsertKind =
  | "paragraph"
  | "heading"
  | "list"
  | "check"
  | "quote"
  | "code"
  | "table"
  | "line";

function insertBlock(block: HTMLElement, kind: InsertKind) {
  hideGutterNow();
  setBlockCaret(block, "end");
  runToolbarAction("insert-after");
  if (kind === "paragraph") {
    return;
  }
  if (kind === "heading") {
    vditor.value?.vditor.toolbar?.elements?.headings
      ?.querySelector<HTMLElement>('[data-tag="h2"]')
      ?.click();
    return;
  }
  runToolbarAction(kind);
}

function insertAtBlock(block: HTMLElement, before: boolean) {
  hideGutterNow();
  setBlockCaret(block, before ? "start" : "end");
  runToolbarAction(before ? "insert-before" : "insert-after");
}

function moveBlock(block: HTMLElement, direction: -1 | 1) {
  const sibling =
    direction < 0 ? block.previousElementSibling : block.nextElementSibling;
  if (!(sibling instanceof HTMLElement)) {
    return;
  }
  if (direction < 0) {
    sibling.before(block);
  } else {
    sibling.after(block);
  }
  syncDomChange();
  hideGutterNow();
}

function deleteBlock(block: HTMLElement) {
  const reset = editorReset();
  if (!reset) {
    return;
  }
  const following =
    block.nextElementSibling instanceof HTMLElement
      ? block.nextElementSibling
      : null;
  const preceding =
    block.previousElementSibling instanceof HTMLElement
      ? block.previousElementSibling
      : null;
  block.remove();
  if (!reset.children.length) {
    reset.insertAdjacentHTML("beforeend", '<p data-block="0"><br></p>');
  }
  syncDomChange();
  if (following) {
    setBlockCaret(following, "start");
  } else if (preceding) {
    setBlockCaret(preceding, "end");
  }
  hideGutterNow();
}

async function copyBlock(block: HTMLElement) {
  const markdown = vditor.value?.vditor.lute
    .VditorIRDOM2Md(block.outerHTML)
    .trim();
  hideGutterNow();
  if (!markdown) {
    return;
  }
  try {
    await navigator.clipboard.writeText(markdown);
    vditor.value?.tip("已复制块 Markdown");
  } catch {
    vditor.value?.tip("复制失败");
  }
}

function anchorAt(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  if (!rect) {
    return event;
  }
  return new MouseEvent("click", {
    clientX: rect.right + 6,
    clientY: rect.bottom + 4,
    bubbles: true,
    cancelable: true,
  });
}

function openEditorMenu(
  event: MouseEvent,
  items: MenuItem[],
  actions: Record<string, () => void>,
) {
  event.preventDefault();
  event.stopPropagation();
  menuActions = actions;
  menuItems.value = items;
  menuPos.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}

function onMenuSelect(id: string) {
  menuOpen.value = false;
  const action = menuActions[id];
  menuActions = {};
  action?.();
}

function onPlusClick(event: MouseEvent) {
  const block = gutterBlock.value;
  if (!block) {
    return;
  }
  hideGutterNow();
  openEditorMenu(
    anchorAt(event),
    [
      { id: "plus:paragraph", label: "段落", icon: menuIcons.text },
      { id: "plus:heading", label: "二级标题", icon: menuIcons.title },
      { id: "plus:list", label: "无序列表", icon: menuIcons.list },
      { id: "plus:check", label: "任务列表", icon: menuIcons.check },
      { id: "plus:quote", label: "引用", icon: menuIcons.quote },
      { id: "plus:code", label: "代码块", icon: menuIcons.code },
      { id: "plus:table", label: "表格", icon: menuIcons.table },
      { id: "plus:line", label: "分隔线", icon: menuIcons.line },
    ],
    {
      "plus:paragraph": () => insertBlock(block, "paragraph"),
      "plus:heading": () => insertBlock(block, "heading"),
      "plus:list": () => insertBlock(block, "list"),
      "plus:check": () => insertBlock(block, "check"),
      "plus:quote": () => insertBlock(block, "quote"),
      "plus:code": () => insertBlock(block, "code"),
      "plus:table": () => insertBlock(block, "table"),
      "plus:line": () => insertBlock(block, "line"),
    },
  );
}

function onHandleClick(event: MouseEvent) {
  const block = gutterBlock.value;
  if (!block || draggingBlock || suppressHandleClick) {
    suppressHandleClick = false;
    return;
  }
  hideGutterNow();
  openEditorMenu(
    anchorAt(event),
    [
      {
        id: "block:before",
        label: "上方插入段落",
        icon: menuIcons.top,
      },
      {
        id: "block:after",
        label: "下方插入段落",
        icon: menuIcons.plus,
      },
      {
        id: "block:copy",
        label: "复制块",
        icon: menuIcons.copy,
        divided: true,
      },
      {
        id: "block:up",
        label: "上移",
        icon: menuIcons.top,
        disabled: !block.previousElementSibling,
      },
      {
        id: "block:down",
        label: "下移",
        icon: menuIcons.move,
        disabled: !block.nextElementSibling,
      },
      {
        id: "block:delete",
        label: "删除块",
        icon: menuIcons.trash,
        danger: true,
        divided: true,
      },
    ],
    {
      "block:before": () => insertAtBlock(block, true),
      "block:after": () => insertAtBlock(block, false),
      "block:copy": () => void copyBlock(block),
      "block:up": () => moveBlock(block, -1),
      "block:down": () => moveBlock(block, 1),
      "block:delete": () => deleteBlock(block),
    },
  );
}

function updateDropTarget(target: HTMLElement, clientY: number) {
  const host = hostEl.value;
  if (!host) {
    return;
  }
  const rect = target.getBoundingClientRect();
  const after = clientY > rect.top + rect.height / 2;
  dropTarget = { block: target, after };
  const hostRect = host.getBoundingClientRect();
  dropLine.value = {
    top: (after ? rect.bottom : rect.top) - hostRect.top,
    left: rect.left - hostRect.left,
    width: rect.width,
  };
}

function onHandleMouseDown(event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }
  const block = gutterBlock.value;
  if (!block) {
    return;
  }
  event.preventDefault();
  dragStart = { x: event.clientX, y: event.clientY };
  dragActive = false;
  draggingBlock = block;
  window.addEventListener("mousemove", onDragMouseMove);
  window.addEventListener("mouseup", onDragMouseUp);
}

function onDragMouseMove(event: MouseEvent) {
  if (!draggingBlock || !dragStart) {
    return;
  }
  if (!dragActive) {
    if (
      Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 4
    ) {
      return;
    }
    dragActive = true;
    draggingBlock.classList.add("wb-block-dragging");
    hideGutterNow();
  }
  const target = topBlockOf(
    document.elementFromPoint(event.clientX, event.clientY),
  );
  if (!target) {
    dropLine.value = null;
    dropTarget = null;
    return;
  }
  updateDropTarget(target, event.clientY);
}

function cleanupDrag() {
  draggingBlock?.classList.remove("wb-block-dragging");
  draggingBlock = null;
  dropTarget = null;
  dropLine.value = null;
}

function onDragMouseUp() {
  window.removeEventListener("mousemove", onDragMouseMove);
  window.removeEventListener("mouseup", onDragMouseUp);
  const source = draggingBlock;
  const target = dropTarget;
  const moved = dragActive;
  dragStart = null;
  dragActive = false;
  if (moved && source && target && target.block !== source) {
    const noop =
      (target.after && target.block.nextElementSibling === source) ||
      (!target.after && target.block.previousElementSibling === source);
    if (!noop) {
      if (target.after) {
        target.block.after(source);
      } else {
        target.block.before(source);
      }
      syncDomChange();
    }
  }
  cleanupDrag();
  if (moved) {
    suppressHandleClick = true;
    window.setTimeout(() => {
      suppressHandleClick = false;
    }, 0);
    hideGutterNow();
  }
}

function onEditorScroll() {
  if (gutterBlock.value) {
    positionGutter(gutterBlock.value);
  }
}

function onEditorContextMenu(event: MouseEvent) {
  const reset = editorReset();
  if (!reset || !(event.target instanceof Node) || !reset.contains(event.target)) {
    return;
  }
  // 没有选区时把光标落到右键位置，保证菜单里的格式与插入动作有明确作用点
  const selection = window.getSelection();
  if (selection && (selection.rangeCount === 0 || selection.isCollapsed)) {
    const range = caretRangeAt(event);
    if (range && reset.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  hideGutterNow();
  openEditorMenu(
    event,
    [
      { id: "fmt:bold", label: "粗体", icon: menuIcons.bold },
      { id: "fmt:italic", label: "斜体", icon: menuIcons.italic },
      { id: "fmt:strike", label: "删除线", icon: menuIcons.strike },
      {
        id: "fmt:inline-code",
        label: "行内代码",
        icon: menuIcons.code,
        divided: true,
      },
      { id: "fmt:link", label: "链接", icon: menuIcons.link },
      { id: "fmt:quote", label: "引用", icon: menuIcons.quote, divided: true },
      { id: "fmt:list", label: "无序列表", icon: menuIcons.list },
      { id: "fmt:ordered", label: "有序列表", icon: menuIcons.ordered },
      { id: "fmt:check", label: "任务列表", icon: menuIcons.check },
      { id: "fmt:code", label: "代码块", icon: menuIcons.code },
      { id: "fmt:table", label: "表格", icon: menuIcons.table },
      {
        id: "fmt:insert-before",
        label: "上方插入段落",
        icon: menuIcons.top,
        divided: true,
      },
      {
        id: "fmt:insert-after",
        label: "下方插入段落",
        icon: menuIcons.plus,
      },
      { id: "fmt:undo", label: "撤销", icon: menuIcons.undo, divided: true },
      { id: "fmt:redo", label: "重做", icon: menuIcons.redo },
    ],
    {
      "fmt:bold": () => runToolbarAction("bold"),
      "fmt:italic": () => runToolbarAction("italic"),
      "fmt:strike": () => runToolbarAction("strike"),
      "fmt:inline-code": () => runToolbarAction("inline-code"),
      "fmt:link": () => runToolbarAction("link"),
      "fmt:quote": () => runToolbarAction("quote"),
      "fmt:list": () => runToolbarAction("list"),
      "fmt:ordered": () => runToolbarAction("ordered-list"),
      "fmt:check": () => runToolbarAction("check"),
      "fmt:code": () => runToolbarAction("code"),
      "fmt:table": () => runToolbarAction("table"),
      "fmt:insert-before": () => runToolbarAction("insert-before"),
      "fmt:insert-after": () => runToolbarAction("insert-after"),
      "fmt:undo": () => runToolbarAction("undo"),
      "fmt:redo": () => runToolbarAction("redo"),
    },
  );
}

function onTitleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    focusEditor();
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    flushAll();
  }
}

function fileFromDataUrl(src: string): File | undefined {
  const matched = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/is.exec(src);
  if (!matched) {
    return;
  }
  try {
    const mime = matched[1].toLowerCase();
    const data = matched[2]
      ? Uint8Array.from(atob(matched[3].replace(/\s/g, "")), (ch) =>
          ch.charCodeAt(0),
        )
      : new TextEncoder().encode(decodeURIComponent(matched[3]));
    const ext = mime === "image/svg+xml" ? "svg" : mime.split("/")[1] || "png";
    return new File([data], `pasted.${ext}`, { type: mime });
  } catch {
    return;
  }
}

// Vditor 粘贴时只要剪贴板带 HTML 就走 HTML 分支：data: 图片会被清洗成空地址，
// 留下一个 ![]()；同时带 file:// 的截图也会变成加载不出来的本地地址。
// 这里先取出真正的图片文件（含内联 svg），交给附件上传。
function clipboardImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file && file.size > 0) {
      files.push(file);
    }
  }
  if (files.length > 0) {
    return files;
  }
  const html = data.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const embedded: File[] = [];
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src.startsWith("data:image/")) {
        return;
      }
      const file = fileFromDataUrl(src);
      if (file) {
        embedded.push(file);
      }
    });
    const svg = doc.querySelector("svg");
    if (embedded.length === 0 && svg) {
      embedded.push(
        new File([new XMLSerializer().serializeToString(svg)], "pasted.svg", {
          type: "image/svg+xml",
        }),
      );
    }
    if (embedded.length > 0) {
      return embedded;
    }
  }
  const plain = data.getData("text/plain").trim();
  if (isSvgSource(plain)) {
    return [new File([plain], "pasted.svg", { type: "image/svg+xml" })];
  }
  return [];
}

// draw.io 等工具导出的 SVG 源码带 XML 声明和 DOCTYPE，不一定以 <svg 开头
function isSvgSource(value: string) {
  const text = value.replace(/^\uFEFF/, "").trimStart();
  if (!/<\/svg>\s*$/i.test(text) || !/<svg[\s>]/i.test(text.slice(0, 2000))) {
    return false;
  }
  return /^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!DOCTYPE[\s\S]*?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
    text,
  );
}

function onPasteCapture(event: ClipboardEvent) {
  if (!event.clipboardData) {
    return;
  }
  // 代码块里的粘贴保持纯文本行为（IR 的编辑根节点本身就是 pre，只能按光标判断）
  const anchor = window.getSelection()?.anchorNode;
  const holder =
    anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
  if (holder?.closest("code")) {
    return;
  }
  const images = clipboardImageFiles(event.clipboardData);
  if (images.length === 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void handleUpload(images).then((message) => {
    if (typeof message === "string") {
      vditor.value?.tip(message, 3000);
    }
  });
}

async function handleUpload(files: File[]) {
  if (!props.upload) {
    return "没有附件上传权限";
  }
  for (const file of files) {
    try {
      const attachment = await props.upload(file);
      const permalink = attachment?.status?.permalink;
      if (!permalink) {
        throw new Error(`${file.name} 上传失败`);
      }
      const isImage =
        attachment.spec?.mediaType?.startsWith("image/") ||
        file.type.startsWith("image/");
      const label = (attachment.spec?.displayName || file.name).replace(
        /[[\]]/g,
        "",
      );
      vditor.value?.insertValue(
        isImage ? `![${label}](${permalink})` : `[${label}](${permalink})`,
      );
    } catch (e) {
      return e instanceof Error ? e.message : "上传失败";
    }
  }
  return null;
}

function applyTheme() {
  const dark = isDark();
  vditor.value?.setTheme(
    dark ? "dark" : "classic",
    dark ? "dark" : "light",
    dark ? "github-dark" : "github",
    CONTENT_THEME_PATH,
  );
  // 深浅色切换后 mermaid 的配色要重算，已有的图需要重新渲染
  void renderMermaidBlocks();
}

let themeObserver: MutationObserver | undefined;

onMounted(async () => {
  if (!editorEl.value) {
    return;
  }
  // 有 mermaid 时先等一小会儿：脚本已缓存就当场打配色补丁，首次下载则不再阻塞编辑器，
  // 等脚本到位后再补补丁并按源码重绘预览
  if (props.raw?.includes("```mermaid")) {
    await Promise.race([ensureMermaid(), new Promise((resolve) => window.setTimeout(resolve, 120))]);
    applyMermaidTheme();
    void ensureMermaid().then(() => {
      applyMermaidTheme();
      void renderMermaidBlocks();
    });
  }
  const dark = isDark();
  vditor.value = new Vditor(editorEl.value, {
    cdn: CDN,
    mode: "ir",
    value: props.raw ?? "",
    height: "100%",
    placeholder: "开始写作…",
    lang: "zh_CN",
    icon: "ant",
    theme: dark ? "dark" : "classic",
    cache: { enable: false },
    // 工具栏整体隐藏；这些动作供右键菜单与块手柄调用
    toolbar: [
      "headings",
      "bold",
      "italic",
      "strike",
      "link",
      "list",
      "ordered-list",
      "check",
      "quote",
      "inline-code",
      "code",
      "line",
      "table",
      "undo",
      "redo",
      "insert-before",
      "insert-after",
    ],
    outline: { enable: true, position: "right" },
    preview: {
      maxWidth: 800,
      theme: {
        current: dark ? "dark" : "light",
        path: CONTENT_THEME_PATH,
      },
      hljs: { style: dark ? "github-dark" : "github", lineNumber: false },
    },
    upload: {
      accept:
        "image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json",
      handler: handleUpload,
    },
    input: onInput,
    blur: flushAll,
    after: () => {
      ready.value = true;
      const instance = vditor.value;
      if (instance) {
        syncOutline();
        scheduleInlineHtml();
        instance.vditor.outline.element.addEventListener(
          "click",
          onOutlineClick,
          true,
        );
        // 打开即回写渲染结果，避免站点端沿用与 Markdown 源码不一致的旧 HTML。
        // 整篇 DOM→HTML 转换比较重，放到首帧之后，先把正文显示出来
        window.setTimeout(() => {
          if (vditor.value === instance) {
            emit("update:content", withHeadingIds(instance.getHTML()));
          }
        }, 0);
      }
      if (!props.title && !props.raw) {
        titleEl.value?.focus();
      } else {
        vditor.value?.focus();
      }
    },
  });

  window.addEventListener("keydown", onWindowKeydown, true);
  editorEl.value?.addEventListener("contextmenu", onEditorContextMenu);
  editorEl.value?.addEventListener("scroll", onEditorScroll, true);
  themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
});

watch(outlineHidden, (hidden) => {
  localStorage.setItem(OUTLINE_KEY, hidden ? "1" : "0");
  applyOutline();
});

watch(
  () => props.raw,
  (value) => {
    if (!ready.value || !vditor.value) {
      return;
    }
    const next = value ?? "";
    if (next !== vditor.value.getValue()) {
      vditor.value.setValue(next, true);
      syncOutline();
      scheduleInlineHtml();
    }
  },
);

onBeforeUnmount(() => {
  window.clearTimeout(contentTimer);
  window.clearTimeout(flyoutTimer);
  window.clearTimeout(inlineHtmlTimer);
  window.clearTimeout(gutterTimer);
  window.removeEventListener("keydown", onWindowKeydown, true);
  window.removeEventListener("mousemove", onDragMouseMove);
  window.removeEventListener("mouseup", onDragMouseUp);
  editorEl.value?.removeEventListener("contextmenu", onEditorContextMenu);
  editorEl.value?.removeEventListener("scroll", onEditorScroll, true);
  themeObserver?.disconnect();
  vditor.value?.destroy();
  vditor.value = undefined;
});
</script>

<template>
  <div class="wb-md">
    <div class="wb-md__head">
      <input
        ref="titleEl"
        class="wb-md__title"
        type="text"
        :value="title"
        placeholder="标题"
        @input="onTitleInput"
        @keydown="onTitleKeydown"
      />
    </div>
    <div
      ref="hostEl"
      class="wb-md__body"
      @mousemove="onEditorMouseMove"
      @mouseleave="scheduleGutterHide"
    >
      <div
        ref="editorEl"
        class="wb-md__editor"
        @paste.capture="onPasteCapture"
      ></div>

      <div
        v-if="gutterBlock"
        class="wb-block-gutter"
        :class="{ 'is-compact': gutterPos.compact }"
        :style="{
          left: `${gutterPos.left}px`,
          top: `${gutterPos.top}px`,
          width: `${gutterPos.width}px`,
        }"
        @mouseenter="cancelGutterHide"
      >
        <button
          type="button"
          class="wb-block-gutter__btn"
          title="在下方插入内容"
          aria-label="在下方插入内容"
          @mousedown.prevent
          @click="onPlusClick"
        >
          <svg class="wb-block-gutter__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        </button>
        <button
          type="button"
          class="wb-block-gutter__btn wb-block-gutter__handle"
          title="拖动排序 / 块操作"
          aria-label="块操作"
          @mousedown="onHandleMouseDown"
          @click="onHandleClick"
        >
          <svg class="wb-block-gutter__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="5.5" cy="4" r="1.1" />
            <circle cx="10.5" cy="4" r="1.1" />
            <circle cx="5.5" cy="8" r="1.1" />
            <circle cx="10.5" cy="8" r="1.1" />
            <circle cx="5.5" cy="12" r="1.1" />
            <circle cx="10.5" cy="12" r="1.1" />
          </svg>
        </button>
      </div>

      <div
        v-if="dropLine"
        class="wb-block-drop-line"
        :style="{
          top: `${dropLine.top}px`,
          left: `${dropLine.left}px`,
          width: `${dropLine.width}px`,
        }"
      ></div>

      <template v-if="outlineAvailable">
        <button
          v-if="!outlineHidden && panelOpen"
          class="wb-outline-arrow"
          title="折叠大纲"
          aria-label="折叠大纲"
          @click="setOutlineHidden(true)"
        >
          ›
        </button>

        <div
          v-else
          class="wb-outline-rail"
          @mouseenter="showFlyout"
          @mouseleave="hideFlyout"
        >
          <button
            class="wb-outline-rail__expand"
            title="展开大纲"
            aria-label="展开大纲"
            @click="setOutlineHidden(false)"
          >
            ‹
          </button>
          <button
            v-for="(heading, index) in headings.slice(0, 14)"
            :key="`dash-${index}`"
            class="wb-outline-dash"
            :class="`is-h${heading.level}`"
            :title="heading.text"
            @click="jump(index)"
          ></button>

          <div v-if="outlineFlyout" class="wb-outline-flyout">
            <div class="wb-outline-flyout__head">大纲</div>
            <button
              v-for="(heading, index) in headings"
              :key="`item-${index}`"
              class="wb-outline-flyout__item"
              :class="`is-h${heading.level}`"
              @click="jump(index)"
            >
              {{ heading.text }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <ContextMenu
      :open="menuOpen"
      :x="menuPos.x"
      :y="menuPos.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="menuOpen = false"
    />
  </div>
</template>

<style scoped>
.wb-md {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.wb-md__head {
  flex: none;
  padding: 28px 35px 0;
}

.wb-md__title {
  display: block;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0 0 12px;
  border: 0;
  border-bottom: 1px solid #f3f4f6;
  outline: none;
  background: transparent;
  color: #111827;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.25;
}

.wb-md__title::placeholder {
  color: #d1d5db;
}

.wb-md__body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.wb-md__editor {
  height: 100%;
}

/* 块左侧悬停手柄：+ 插块，六点柄拖动排序/打开块菜单 */
.wb-block-gutter {
  position: absolute;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  gap: 2px;
  height: 26px;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.wb-block-gutter:hover {
  opacity: 1;
}

.wb-block-gutter__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 23px;
  height: 26px;
  padding: 0;
  color: var(--wb-faint);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}

.wb-block-gutter__btn:hover {
  color: var(--wb-text);
  background: var(--wb-hover);
}

.wb-block-gutter__icon {
  width: 14px;
  height: 14px;
}

.wb-block-gutter.is-compact .wb-block-gutter__btn {
  width: 17px;
}

.wb-block-gutter.is-compact .wb-block-gutter__icon {
  width: 12px;
  height: 12px;
}

.wb-block-gutter__handle {
  cursor: grab;
}

.wb-block-gutter__handle:active {
  cursor: grabbing;
}

.wb-md__editor :deep(.wb-block-dragging) {
  opacity: 0.35;
}

.wb-block-drop-line {
  position: absolute;
  z-index: 6;
  height: 2px;
  pointer-events: none;
  background: var(--wb-accent);
  border-radius: 2px;
  box-shadow: 0 0 0 2px var(--wb-accent-soft);
}

/* 大纲面板宽 250px，折叠按钮压在它的左边缘上 */
.wb-md__body > .wb-outline-arrow {
  right: 242px;
}

.wb-md__editor :deep(.vditor) {
  border: 0;
  border-radius: 0;
}

.wb-md__editor :deep(.vditor-toolbar) {
  display: none;
}

.wb-md__editor :deep(.vditor-reset) {
  font-size: 16px;
}

/* 标题前的 H1/H2 角标会占掉手柄位置，隐藏后用字号表达层级 */
.wb-md__editor :deep(.vditor-ir .vditor-reset > h1:before),
.wb-md__editor :deep(.vditor-ir .vditor-reset > h2:before),
.wb-md__editor :deep(.vditor-ir .vditor-reset > h3:before),
.wb-md__editor :deep(.vditor-ir .vditor-reset > h4:before),
.wb-md__editor :deep(.vditor-ir .vditor-reset > h5:before),
.wb-md__editor :deep(.vditor-ir .vditor-reset > h6:before) {
  content: none;
  margin-left: 0;
}

/* Vditor 给行内代码设了 pre-wrap + break-word，表格里会被压成一两字符宽，改成不换行让表格横向滚动 */
.wb-md__editor :deep(.vditor-reset table code:not(.hljs)) {
  white-space: nowrap;
  word-break: normal;
}

/* mermaid 图：与站点前台同一套卡片样式（theme-hao 的 text-diagram） */
.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid)) {
  margin: 10px 0;
  padding: 18px 14px;
  overflow-x: auto;
  text-align: center;
  background-color: rgb(255 255 255 / 0.92);
  background-image: radial-gradient(circle, rgb(99 102 241 / 0.08) 1.2px, transparent 1.2px);
  background-size: 20px 20px;
  border: 1px solid #eceef5;
  border-radius: 16px;
  box-shadow:
    0 1px 2px rgb(15 23 42 / 0.06),
    0 10px 30px -12px rgb(15 23 42 / 0.06);
}

.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) svg) {
  max-width: 100%;
  height: auto;
}

.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) .node rect),
.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) .node polygon),
.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) .node circle) {
  rx: 10;
  ry: 10;
  stroke-width: 1.4px;
  filter: drop-shadow(0 1px 2px rgb(15 23 42 / 0.05));
}

.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) .nodeLabel) {
  font-weight: 600;
}

.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) .flowchart-link),
.wb-md__editor :deep(.vditor-ir__preview:has(.language-mermaid) .edgePath .path) {
  stroke-width: 1.8px;
}

:global(html.dark .wb-md__editor .vditor-ir__preview:has(.language-mermaid)),
:global(html[data-theme="dark"] .wb-md__editor .vditor-ir__preview:has(.language-mermaid)),
:global(body.dark .wb-md__editor .vditor-ir__preview:has(.language-mermaid)) {
  background-color: rgb(22 28 42 / 0.85);
  background-image: radial-gradient(circle, rgb(148 163 184 / 0.09) 1.2px, transparent 1.2px);
  border-color: rgb(148 163 184 / 0.14);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.45),
    0 10px 30px -12px rgb(0 0 0 / 0.45);
}

/* 行内 HTML 补出来的预览：跟着文字走，不要撑出块级间距 */
.wb-md__editor :deep(.vditor-ir span.vditor-ir__preview) {
  min-height: 0;
}

.wb-md__editor :deep(.vditor-ir span.vditor-ir__preview img) {
  max-width: 100%;
  vertical-align: middle;
}

:global(html.dark .wb-md),
:global(html[data-theme="dark"] .wb-md),
:global(body.dark .wb-md) {
  /* 折叠轨道、悬浮大纲都沿用这些变量，深色下跟随编辑器配色 */
  --wb-accent: #58a6ff;
  --wb-text: #e5e7eb;
  --wb-muted: #8b949e;
  --wb-faint: #8b949e;
  --wb-border: #30363d;
  --wb-border-strong: #4b535d;
  --wb-bg: #1c2128;
  --wb-panel: #2d333b;
  --wb-hover: #373e47;
  background: #24292e;
}

:global(html.dark .wb-md__title),
:global(html[data-theme="dark"] .wb-md__title),
:global(body.dark .wb-md__title) {
  border-bottom-color: #2f363d;
  color: #e5e7eb;
}

:global(html.dark .wb-md__title::placeholder),
:global(html[data-theme="dark"] .wb-md__title::placeholder),
:global(body.dark .wb-md__title::placeholder) {
  color: #6b7280;
}</style>
