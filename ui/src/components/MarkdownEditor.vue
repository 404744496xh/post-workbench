<script setup lang="ts">
import type { Attachment } from "@halo-dev/api-client";
import type { AxiosRequestConfig } from "axios";
import Vditor from "vditor";
import "vditor/dist/index.css";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

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

const editorEl = ref<HTMLDivElement>();
const titleEl = ref<HTMLInputElement>();
const vditor = shallowRef<Vditor>();
const ready = ref(false);

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

function flushContent() {
  window.clearTimeout(contentTimer);
  if (!vditor.value) {
    return;
  }
  syncOutline();
  emit("update:content", vditor.value.getHTML());
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
  emit("update:content", vditor.value.getHTML());
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

function onInput(value: string) {
  scheduleInlineHtml();
  emit("update:raw", value);
  emit("update", value);
  window.clearTimeout(contentTimer);
  contentTimer = window.setTimeout(flushContent, 350);
}

function onTitleInput(event: Event) {
  emit("update:title", (event.target as HTMLInputElement).value);
}

function focusEditor() {
  vditor.value?.focus();
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
}

let themeObserver: MutationObserver | undefined;

onMounted(() => {
  if (!editorEl.value) {
    return;
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
    toolbar: [],
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
        // 打开即回写渲染结果，避免站点端沿用与 Markdown 源码不一致的旧 HTML
        emit("update:content", instance.getHTML());
      }
      if (!props.title && !props.raw) {
        titleEl.value?.focus();
      } else {
        vditor.value?.focus();
      }
    },
  });

  window.addEventListener("keydown", onWindowKeydown, true);
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
  window.removeEventListener("keydown", onWindowKeydown, true);
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
    <div class="wb-md__body">
      <div ref="editorEl" class="wb-md__editor"></div>

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
