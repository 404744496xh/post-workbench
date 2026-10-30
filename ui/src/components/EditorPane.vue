<script setup lang="ts">
import type { Router } from "vue-router";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { BLANK_EDITOR_PATH, editorPath } from "../api";

type Mode = "idle" | "blank" | "post";

const props = defineProps<{
  mode: Mode;
  postName?: string;
}>();

const emit = defineEmits<{
  (e: "frame-route", path: string): void;
  (e: "ready"): void;
  (e: "create"): void;
}>();

const VOID_PATH = "/__post-workbench-void__";
const STYLE_ID = "post-workbench-frame-style";
const FRAME_CSS = `
.layout > aside.sidebar { display: none !important; }
.layout > .main-content { width: 100% !important; margin-left: 0 !important; padding-bottom: 0 !important; }
.main-content__footer { display: none !important; }
.mobile-nav { display: none !important; }
html.wb-outline-hidden .editor-entry-extra { display: none !important; }
`;

const iframeEl = ref<HTMLIFrameElement>();
const frameMounted = ref(false);
const frameReady = ref(false);
const frameVisible = ref(false);
const outlineAvailable = ref(false);
const outlineHidden = ref(localStorage.getItem("post-workbench:outline-hidden") === "1");
const src = ref<string>();
const loading = ref(false);

let outlineTimer: number | undefined;

function applyOutlineState() {
  const doc = iframeEl.value?.contentWindow?.document;
  doc?.documentElement.classList.toggle("wb-outline-hidden", outlineHidden.value);
}

function watchOutline(win: Window) {
  window.clearInterval(outlineTimer);
  const started = Date.now();
  outlineTimer = window.setInterval(() => {
    const exists = !!win.document.querySelector(".editor-entry-extra");
    outlineAvailable.value = exists;
    if (exists) {
      applyOutlineState();
      window.clearInterval(outlineTimer);
      return;
    }
    if (Date.now() - started > 5000) {
      window.clearInterval(outlineTimer);
    }
  }, 200);
}

watch(outlineHidden, (value) => {
  localStorage.setItem("post-workbench:outline-hidden", value ? "1" : "0");
  applyOutlineState();
});

let suppressUntil = 0;
let navToken = 0;
let readyTimer: number | undefined;

const appPath = computed(() =>
  props.mode === "post" && props.postName
    ? `/posts/editor?name=${encodeURIComponent(props.postName)}`
    : "/posts/editor",
);

const browserPath = computed(() =>
  props.mode === "post" && props.postName ? editorPath(props.postName) : BLANK_EDITOR_PATH,
);

watch(
  () => [props.mode, props.postName] as const,
  () => {
    if (props.mode === "idle") {
      return;
    }
    if (!frameMounted.value) {
      frameMounted.value = true;
      src.value = browserPath.value;
      loading.value = true;
      return;
    }
    void navigateTo(appPath.value);
  },
  { immediate: true },
);

function getRouter(win: Window): Router | undefined {
  const app = (win.document.querySelector("#app") as { __vue_app__?: any } | null)?.__vue_app__;
  return app?.config?.globalProperties?.$router;
}

function waitUntil(check: () => boolean, timeout: number, interval = 40) {
  return new Promise<boolean>((resolve) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try {
        ok = check();
      } catch {
        ok = false;
      }
      if (ok) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, interval);
    };
    tick();
  });
}

function injectStyle(win: Window) {
  const doc = win.document;
  if (!doc.head || doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FRAME_CSS;
  doc.head.appendChild(style);
}

function hookRouter(win: Window) {
  const router = getRouter(win);
  const patched = win as unknown as { __wbRouterHooked?: boolean };
  if (!router || patched.__wbRouterHooked) {
    return;
  }
  patched.__wbRouterHooked = true;
  router.afterEach((to) => {
    if (Date.now() < suppressUntil) {
      return;
    }
    emit("frame-route", to.fullPath);
  });
}

function onLoad() {
  const win = iframeEl.value?.contentWindow;
  if (!win) {
    return;
  }
  injectStyle(win);
  frameReady.value = false;
  frameVisible.value = false;
  loading.value = true;
  window.clearInterval(readyTimer);
  const started = Date.now();
  readyTimer = window.setInterval(() => {
    hookRouter(win);
    const ready = !!win.document.querySelector(".editor");
    if (!ready && Date.now() - started < 5000) {
      return;
    }
    window.clearInterval(readyTimer);
    frameReady.value = true;
    frameVisible.value = true;
    loading.value = false;
    outlineAvailable.value = !!win.document.querySelector(".editor-entry-extra");
    applyOutlineState();
    watchOutline(win);
    suppressUntil = Date.now() + 300;
    emit("ready");
  }, 100);
}

async function navigateTo(targetAppPath: string, force = false) {
  const win = iframeEl.value?.contentWindow;
  if (!win) {
    return;
  }
  const router = getRouter(win);
  if (!router || !frameReady.value) {
    const url = `/console${targetAppPath}`;
    if (src.value !== url) {
      src.value = url;
      loading.value = true;
    }
    return;
  }
  if (!force && router.currentRoute.value.fullPath === targetAppPath) {
    return;
  }

  const token = ++navToken;
  loading.value = true;
  suppressUntil = Date.now() + 5000;
  let fallback = false;
  try {
    if (router.currentRoute.value.path === "/posts/editor") {
      await router.replace(VOID_PATH);
      const unmounted = await waitUntil(() => !win.document.querySelector(".editor"), 800);
      if (token !== navToken) {
        return;
      }
      if (!unmounted) {
        fallback = true;
        win.location.href = `/console${targetAppPath}`;
        return;
      }
    }
    await router.replace(targetAppPath);
    const ok = await waitUntil(
      () =>
        router.currentRoute.value.fullPath === targetAppPath &&
        !!win.document.querySelector(".editor"),
      2800,
    );
    if (!ok) {
      fallback = true;
      win.location.href = `/console${targetAppPath}`;
    } else {
      applyOutlineState();
      watchOutline(win);
    }
  } catch {
    fallback = true;
    win.location.href = `/console${targetAppPath}`;
  } finally {
    if (token === navToken) {
      if (fallback) {
        frameReady.value = false;
        frameVisible.value = false;
        loading.value = true;
      } else {
        loading.value = false;
        suppressUntil = Date.now() + 400;
      }
    }
  }
}

async function reloadCurrent() {
  await navigateTo(appPath.value, true);
}

async function clickHeaderButton(keywords: string[]) {
  const win = iframeEl.value?.contentWindow;
  if (!win) {
    return false;
  }
  const router = getRouter(win);
  const target = appPath.value;
  const ready = await waitUntil(
    () =>
      !loading.value &&
      frameReady.value &&
      !!router &&
      router.currentRoute.value.fullPath === target,
    4000,
  );
  if (!ready) {
    return false;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  const header = win.document.querySelector(".page-header");
  const buttons = Array.from((header ?? win.document).querySelectorAll("button"));
  const button = buttons.find((item) => {
    const text = (item.textContent ?? "").trim();
    return keywords.some((keyword) => text.includes(keyword));
  });
  if (!button) {
    return false;
  }
  button.click();
  return true;
}

onBeforeUnmount(() => {
  window.clearInterval(readyTimer);
  window.clearInterval(outlineTimer);
});

defineExpose({ reloadCurrent, clickHeaderButton });
</script>

<template>
  <section class="wb-editor">
    <div v-if="frameMounted" class="wb-editor__frame" :style="{ opacity: frameVisible ? 1 : 0 }">
      <iframe
        ref="iframeEl"
        :src="src"
        title="文章编辑器"
        @load="onLoad"
      ></iframe>
    </div>

    <button
      v-if="mode !== 'idle' && frameReady && !loading && outlineAvailable"
      class="wb-outline-arrow"
      :title="outlineHidden ? '展开大纲' : '折叠大纲'"
      :aria-label="outlineHidden ? '展开大纲' : '折叠大纲'"
      @click="outlineHidden = !outlineHidden"
    >
      {{ outlineHidden ? "‹" : "›" }}
    </button>

    <div v-if="loading" class="wb-editor__loading">
      <span class="wb-spinner"></span>
      <span>编辑器加载中…</span>
    </div>

    <div v-if="mode === 'idle'" class="wb-empty">
      <div class="wb-empty__icon">✦</div>
      <h3>选择一篇文章开始编辑</h3>
      <p>左侧按分类浏览，悬停查看摘要，右键进行发布、移动等操作。</p>
      <div class="wb-empty__actions">
        <button class="wb-btn is-primary" @click="emit('create')">新建文章</button>
      </div>
    </div>
  </section>
</template>
