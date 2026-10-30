<script setup lang="ts">
import type { ListedPost } from "@halo-dev/api-client";
import {
  Dialog,
  IconArrowRight,
  IconArrowUpCircleLine,
  IconBookRead,
  IconCharacterRecognition,
  IconCodeBoxLine,
  IconDeleteBin,
  IconExternalLinkLine,
  IconEye,
  IconFolder,
  IconLink,
  IconRiPencilFill,
  IconSendPlaneFill,
  IconSettings,
  IconStopCircle,
  Toast,
} from "@halo-dev/components";
import {
  computed,
  markRaw,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { editorPath, patchPostField, publishPost, recyclePost, unpublishPost } from "../api";
import { bypassNativePosts, isOverridePostsEnabled } from "../bootstrap";
import CategoryPicker from "../components/CategoryPicker.vue";
import ContextMenu from "../components/ContextMenu.vue";
import EditorPane from "../components/EditorPane.vue";
import TreePanel from "../components/TreePanel.vue";
import { isMarkdownPost, switchPostEditor } from "../editorSwitch";
import type { PostEditorTarget } from "../editorMeta";
import type { CatNode } from "../composables/useContent";
import { postPhase, useContent } from "../composables/useContent";
import type { MenuItem, MenuTarget } from "../types";

const route = useRoute();
const router = useRouter();

const {
  loading,
  error,
  statusFilter,
  filteredPosts,
  categoryTree,
  uncategorized,
  counts,
  refresh,
  findPost,
} = useContent();

const selectedName = ref<string | undefined>(
  typeof route.query.name === "string" ? route.query.name : undefined,
);
const blankOpen = ref(false);
const pendingCategory = ref<string | null>(null);
const overridePosts = ref(false);

const treeRef = ref<InstanceType<typeof TreePanel>>();
const editorRef = ref<InstanceType<typeof EditorPane>>();

const selectedPost = computed(() => findPost(selectedName.value));

const editorMode = computed<"idle" | "blank" | "post">(() => {
  if (selectedName.value) {
    return "post";
  }
  return blankOpen.value ? "blank" : "idle";
});

function selectPost(name: string) {
  const changed = selectedName.value !== name;
  pendingCategory.value = null;
  blankOpen.value = false;
  selectedName.value = name;
  if (route.query.name !== name) {
    void router.replace({ query: { ...route.query, name } });
  }
  if (changed) {
    void refreshSilently();
  }
}

function createPost(categoryName?: string) {
  pendingCategory.value = categoryName ?? null;
  blankOpen.value = true;
  selectedName.value = undefined;
  if (route.query.name) {
    void router.replace({ query: {} });
  }
}

async function refreshSilently() {
  try {
    await refresh({ silent: true });
  } catch {
    // 静默刷新失败时不打扰用户
  }
}

async function handleFrameRoute(path: string) {
  let url: URL;
  try {
    url = new URL(path, window.location.origin);
  } catch {
    return;
  }

  if (url.pathname === "/posts/editor") {
    const name = url.searchParams.get("name");
    if (!name || name === selectedName.value) {
      return;
    }
    const wasBlank = blankOpen.value;
    const category = pendingCategory.value;
    selectedName.value = name;
    blankOpen.value = false;
    pendingCategory.value = null;
    void router.replace({ query: { ...route.query, name } });
    if (wasBlank && category) {
      try {
        await patchPostField(name, "/spec/categories", [category]);
        await editorRef.value?.reloadCurrent();
      } catch (e) {
        Toast.error(e instanceof Error ? e.message : "设置分类失败");
      }
    }
    await refreshSilently();
    return;
  }

  // 编辑器内触发了发布/返回等跳转，回到当前文章的编辑器
  if (editorMode.value !== "idle") {
    await refreshSilently();
    await editorRef.value?.reloadCurrent();
  }
}

const menu = ref<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
const menuTarget = ref<MenuTarget>();

const icons = {
  open: markRaw(IconBookRead),
  external: markRaw(IconExternalLinkLine),
  eye: markRaw(IconEye),
  link: markRaw(IconLink),
  publish: markRaw(IconSendPlaneFill),
  unpublish: markRaw(IconStopCircle),
  pin: markRaw(IconArrowUpCircleLine),
  folder: markRaw(IconFolder),
  settings: markRaw(IconSettings),
  delete: markRaw(IconDeleteBin),
  create: markRaw(IconRiPencilFill),
  markdown: markRaw(IconCodeBoxLine),
  rich: markRaw(IconCharacterRecognition),
};

const menuItems = computed<MenuItem[]>(() => {
  const target = menuTarget.value;
  if (!target) {
    return [];
  }
  if (target.kind === "category") {
    return [{ id: "new-post", label: "在此分类新建文章", icon: icons.create }];
  }
  const post = target.post;
  const phase = postPhase(post.post);
  const permalink = post.post.status?.permalink;
  const published = phase === "published" || phase === "scheduled";
  return [
    { id: "open", label: "打开", icon: icons.open },
    { id: "open-new", label: "在新标签页打开", icon: icons.external, divided: true },
    { id: "preview", label: "预览", icon: icons.eye, disabled: !permalink },
    { id: "copy", label: "复制链接", icon: icons.link, disabled: !permalink, divided: true },
    published
      ? { id: "unpublish", label: "取消发布", icon: icons.unpublish, divided: true }
      : { id: "publish", label: "发布", icon: icons.publish, divided: true },
    {
      id: "pin",
      label: post.post.spec.pinned ? "取消置顶" : "置顶",
      icon: icons.pin,
    },
    { id: "move", label: "移动到分类…", icon: icons.folder },
    isMarkdownPost(post)
      ? { id: "toggle-editor", label: "切换到富文本编辑器", icon: icons.rich }
      : { id: "toggle-editor", label: "用 Markdown 编辑", icon: icons.markdown },
    { id: "settings", label: "打开设置", icon: icons.settings, divided: true },
    {
      id: "delete",
      label: "删除（移到回收站）",
      icon: icons.delete,
      danger: true,
      divided: true,
    },
  ];
});

function openMenu(payload: { x: number; y: number } & MenuTarget) {
  const { x, y, ...target } = payload;
  menuTarget.value = target as MenuTarget;
  menu.value = { open: true, x, y };
}

function closeMenu() {
  menu.value = { ...menu.value, open: false };
}

async function runPostAction(
  name: string,
  action: () => Promise<unknown>,
  message: string,
) {
  try {
    await action();
    Toast.success(message);
    await refreshSilently();
    if (selectedName.value === name) {
      await editorRef.value?.reloadCurrent();
    }
  } catch (e) {
    Toast.error(e instanceof Error ? e.message : "操作失败");
  }
}

async function movePostToCategory(name: string, category: string | null, label: string) {
  try {
    await patchPostField(name, "/spec/categories", category ? [category] : []);
    Toast.success(`已移动到「${label}」`);
    await refreshSilently();
  } catch (e) {
    Toast.error(e instanceof Error ? e.message : "移动失败");
  }
}

function openNativePosts() {
  bypassNativePosts();
  void router.push("/posts");
}

function permalinkOf(post: ListedPost) {
  const permalink = post.post.status?.permalink;
  if (!permalink) {
    return undefined;
  }
  return new URL(permalink, window.location.origin).toString();
}

function openPermalink(post: ListedPost) {
  const url = permalinkOf(post);
  if (url) {
    window.open(url, "_blank", "noopener");
  }
}

async function copyPermalink(post: ListedPost) {
  const url = permalinkOf(post);
  if (!url) {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  Toast.success("链接已复制");
}

function confirmDelete(post: ListedPost) {
  const name = post.post.metadata.name;
  const title = post.post.spec.title || "无标题";
  Dialog.warning({
    title: "删除文章？",
    description: `「${title}」将移入回收站，可稍后从回收站恢复。`,
    confirmType: "danger",
    confirmText: "移入回收站",
    onConfirm: async () => {
      try {
        await recyclePost(name);
        Toast.success("已移入回收站");
        if (selectedName.value === name) {
          selectedName.value = undefined;
          blankOpen.value = false;
          void router.replace({ query: {} });
        }
        await refreshSilently();
      } catch (e) {
        Toast.error(e instanceof Error ? e.message : "删除失败");
      }
    },
  });
}

const moveDialog = ref<{ open: boolean; post?: ListedPost }>({ open: false });

function openMoveDialog(post: ListedPost) {
  moveDialog.value = { open: true, post };
}

async function confirmMove(names: string[]) {
  const post = moveDialog.value.post;
  moveDialog.value = { open: false, post: undefined };
  if (!post) {
    return;
  }
  const name = post.post.metadata.name;
  await runPostAction(
    name,
    () => patchPostField(name, "/spec/categories", names),
    "分类已更新",
  );
}

async function openSettings(name: string) {
  selectPost(name);
  await nextTick();
  const ok = await editorRef.value?.clickHeaderButton(["设置", "Settings"]);
  if (!ok) {
    Toast.warning("请在编辑器右上角点击「设置」");
  }
}

function confirmSwitchEditor(post: ListedPost) {
  const name = post.post.metadata.name;
  const target: PostEditorTarget = isMarkdownPost(post) ? "html" : "markdown";
  const label = target === "markdown" ? "Markdown" : "富文本";
  Dialog.warning({
    title: `切换到${label}编辑器？`,
    description:
      target === "markdown"
        ? "文章内容会转换为 Markdown 源码，颜色、对齐、画廊排版等富文本样式可能丢失。"
        : "文章内容会转换为 HTML 富文本，Markdown 源码将不再保留。",
    confirmText: "切换",
    onConfirm: async () => {
      try {
        if (selectedName.value === name) {
          await editorRef.value?.clickHeaderButton(["保存", "Save"]);
          await new Promise((resolve) => window.setTimeout(resolve, 700));
        }
        await switchPostEditor(post, target);
        Toast.success(`已切换为${label}编辑器`);
        await refreshSilently();
        if (selectedName.value === name) {
          await editorRef.value?.reloadCurrent();
        }
      } catch (e) {
        Toast.error(e instanceof Error ? e.message : "切换编辑器失败");
      }
    },
  });
}

async function handleMenuSelect(id: string) {
  const target = menuTarget.value;
  if (!target) {
    return;
  }
  if (target.kind === "category") {
    if (id === "new-post") {
      createPost(target.node.name);
    }
    return;
  }
  const post = target.post;
  const name = post.post.metadata.name;
  switch (id) {
    case "open":
      selectPost(name);
      break;
    case "open-new":
      window.open(editorPath(name), "_blank", "noopener");
      break;
    case "preview":
      openPermalink(post);
      break;
    case "copy":
      await copyPermalink(post);
      break;
    case "publish":
      if (selectedName.value === name) {
        await editorRef.value?.clickHeaderButton(["保存", "Save"]);
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
      await runPostAction(name, () => publishPost(name), "已发布");
      break;
    case "unpublish":
      await runPostAction(name, () => unpublishPost(name), "已取消发布");
      break;
    case "pin":
      await runPostAction(
        name,
        () => patchPostField(name, "/spec/pinned", !post.post.spec.pinned),
        post.post.spec.pinned ? "已取消置顶" : "已置顶",
      );
      break;
    case "move":
      openMoveDialog(post);
      break;
    case "toggle-editor":
      confirmSwitchEditor(post);
      break;
    case "settings":
      await openSettings(name);
      break;
    case "delete":
      confirmDelete(post);
      break;
  }
}

const treeWidth = ref(Number(localStorage.getItem("post-workbench:tree-width")) || 300);
const treeCollapsed = ref(false);
const consoleHidden = ref(localStorage.getItem("post-workbench:console-hidden") === "1");
const rootRef = ref<HTMLElement>();
let resizeObserver: ResizeObserver | undefined;

function applyConsoleHidden() {
  document.body.classList.toggle("wb-console-hidden", consoleHidden.value);
}

watch(consoleHidden, (value) => {
  localStorage.setItem("post-workbench:console-hidden", value ? "1" : "0");
  applyConsoleHidden();
});

const viewActive = ref(true);

onActivated(() => {
  viewActive.value = true;
  applyConsoleHidden();
  mountSidebarArrow();
});

onDeactivated(() => {
  viewActive.value = false;
  unmountSidebarArrow();
  document.body.classList.remove("wb-console-hidden");
});

let sidebarArrow: HTMLButtonElement | undefined;

function mountSidebarArrow() {
  if (sidebarArrow) {
    return;
  }
  const sidebar = document.querySelector(".layout > aside.sidebar");
  if (!sidebar) {
    return;
  }
  sidebarArrow = document.createElement("button");
  sidebarArrow.type = "button";
  sidebarArrow.className = "wb-sidebar-arrow";
  sidebarArrow.title = "收起导航";
  sidebarArrow.setAttribute("aria-label", "收起导航");
  sidebarArrow.textContent = "‹";
  sidebarArrow.addEventListener("click", () => {
    consoleHidden.value = true;
  });
  sidebar.appendChild(sidebarArrow);
}

function unmountSidebarArrow() {
  sidebarArrow?.remove();
  sidebarArrow = undefined;
}

function toggleTree(collapsed: boolean) {
  treeCollapsed.value = collapsed;
}

function startResize(event: PointerEvent) {
  const startX = event.clientX;
  const startWidth = treeWidth.value;
  const onMove = (moveEvent: PointerEvent) => {
    treeWidth.value = Math.min(560, Math.max(220, startWidth + moveEvent.clientX - startX));
  };
  const onUp = () => {
    localStorage.setItem("post-workbench:tree-width", String(treeWidth.value));
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function resetTreeWidth() {
  treeWidth.value = 300;
  localStorage.setItem("post-workbench:tree-width", "300");
}

function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const editing =
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable);
  if (event.key === "/" && !editing) {
    event.preventDefault();
    treeRef.value?.focusSearch();
  }
}

let pollTimer: number | undefined;

function onWindowFocus() {
  void refreshSilently();
}

onMounted(() => {
  applyConsoleHidden();
  mountSidebarArrow();
  void isOverridePostsEnabled().then((value) => {
    overridePosts.value = value;
  });
  void refresh().catch(() => {});
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("keydown", onGlobalKeydown);
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && !loading.value) {
      void refreshSilently();
    }
  }, 60_000);
  if (rootRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0 && width < 1000) {
        treeCollapsed.value = true;
      }
    });
    resizeObserver.observe(rootRef.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("keydown", onGlobalKeydown);
  window.clearInterval(pollTimer);
  resizeObserver?.disconnect();
  unmountSidebarArrow();
  document.body.classList.remove("wb-console-hidden");
});
</script>

<template>
  <div ref="rootRef" class="wb-root" :style="{ '--wb-tree-width': `${treeWidth}px` }">
    <TreePanel
      v-show="!treeCollapsed"
      ref="treeRef"
      :category-tree="categoryTree"
      :posts="filteredPosts"
      :uncategorized="uncategorized"
      :counts="counts"
      :status-filter="statusFilter"
      :loading="loading"
      :error="error"
      :selected-name="selectedName"
      :override-posts="overridePosts"
      @select="selectPost"
      @create="createPost"
      @context-menu="openMenu"
      @update:status-filter="statusFilter = $event"
      @refresh="refreshSilently"
      @collapse="toggleTree(true)"
      @open-native="openNativePosts"
      @move-post="movePostToCategory($event.name, $event.category, $event.label)"
    />

    <div
      v-if="!treeCollapsed"
      class="wb-splitter"
      title="拖动调整宽度，双击复位"
      @pointerdown.prevent="startResize"
      @dblclick="resetTreeWidth"
    ></div>
    <div v-else class="wb-rail">
      <button class="wb-rail__btn" title="展开分类栏" @click="toggleTree(false)">
        <IconArrowRight />
      </button>
    </div>

    <main class="wb-main">
      <EditorPane
        ref="editorRef"
        :mode="editorMode"
        :post-name="selectedName"
        @frame-route="handleFrameRoute"
        @create="createPost()"
      />
    </main>

    <ContextMenu
      :open="menu.open"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @close="closeMenu"
      @select="handleMenuSelect"
    />

    <CategoryPicker
      :open="moveDialog.open"
      title="移动到分类"
      :tree="categoryTree"
      :selected="moveDialog.post?.post.spec.categories ?? []"
      @close="moveDialog = { open: false, post: undefined }"
      @confirm="confirmMove"
    />

    <Teleport to="body">
      <button
        v-if="consoleHidden && viewActive"
        class="wb-edge-arrow"
        title="显示导航"
        aria-label="显示导航"
        @click="consoleHidden = false"
      >
        ›
      </button>
    </Teleport>
  </div>
</template>
