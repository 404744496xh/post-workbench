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

let contentTimer: number | undefined;

function isDark() {
  const root = document.documentElement;
  return (
    root.classList.contains("dark") ||
    root.dataset.theme === "dark" ||
    document.body.classList.contains("dark")
  );
}

function syncOutline() {
  const instance = vditor.value;
  if (!instance) {
    return;
  }
  instance.vditor.outline.render(instance.vditor);
}

// Vditor 只设置 .vditor-ir 的 scrollTop，而真正的滚动容器是内部的 .vditor-reset
function onOutlineClick(event: MouseEvent) {
  const item = (event.target as HTMLElement).closest?.("[data-target-id]");
  const id = item?.getAttribute("data-target-id");
  if (!id) {
    return;
  }
  const heading = document.getElementById(id);
  const scroller = editorEl.value?.querySelector<HTMLElement>(".vditor-ir .vditor-reset");
  if (!heading || !scroller) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const delta =
    heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
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

function onInput(value: string) {
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
        instance.vditor.outline.toggle(instance.vditor, true, false);
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

watch(
  () => props.raw,
  (value) => {
    if (!ready.value || !vditor.value) {
      return;
    }
    const next = value ?? "";
    if (next !== vditor.value.getValue()) {
      vditor.value.setValue(next, true);
    }
  },
);

onBeforeUnmount(() => {
  window.clearTimeout(contentTimer);
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
    <div ref="editorEl" class="wb-md__editor"></div>
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

.wb-md__editor {
  flex: 1;
  min-height: 0;
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

:global(html.dark .wb-md),
:global(html[data-theme="dark"] .wb-md),
:global(body.dark .wb-md) {
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
