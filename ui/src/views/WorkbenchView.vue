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
import { createCategory, editorPath, moveCategory, patchPostField, publishPost, recyclePost, unpublishPost } from "../api";
import { bypassNativePosts, isOverridePostsEnabled } from "../bootstrap";
import CategoryFormDialog from "../components/CategoryFormDialog.vue";
import CategoryPicker from "../components/CategoryPicker.vue";
import ContextMenu from "../components/ContextMenu.vue";
import EditorPane from "../components/EditorPane.vue";
import TreePanel from "../components/TreePanel.vue";
import {
  cachedEditorKind,
  isMarkdownPost,
  rememberEditorKind,
  resolveEditorKind,
  switchPostEditor,
} from "../editorSwitch";
import type { PostEditorTarget } from "../editorMeta";
import type { CatNode } from "../composables/useContent";
import { findCategoryNode, postPhase, useContent } from "../composables/useContent";
import type { MenuItem, MenuTarget } from "../types";

const route = useRoute();
const router = useRouter();

const {
  loading,
  error,
  statusFilter,
  filteredPosts,
  categoryTree,
  categorySlugs,
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
const pendingMarkdown = ref(false);
const overridePosts = ref(false);

const treeRef = ref<InstanceType<typeof TreePanel>>();
const editorRef = ref<InstanceType<typeof EditorPane>>();

const selectedPost = computed(() => findPost(selectedName.value));

// 打开文章前要先确认它该用哪个编辑器（Halo 按注解挑，注解可能是错的），确认前不挂载 iframe
const resolvingEditor = ref(!!selectedName.value && !cachedEditorKind(selectedName.value));
let resolveSeq = 0;

const editorMode = computed<"idle" | "blank" | "post">(() => {
  if (selectedName.value) {
    return "post";
  }
  return blankOpen.value ? "blank" : "idle";
});

async function prepareEditor(name: string) {
  if (cachedEditorKind(name)) {
    resolvingEditor.value = false;
    return;
  }
  const seq = ++resolveSeq;
  resolvingEditor.value = true;
  try {
    await resolveEditorKind(name);
  } catch {
    // 解析失败就按现有注解打开，不挡编辑
  } finally {
    if (seq === resolveSeq) {
      resolvingEditor.value = false;
    }
  }
}

function postIsMarkdown(post: ListedPost) {
  const kind = cachedEditorKind(post.post.metadata.name);
  return kind ? kind === "markdown" : isMarkdownPost(post);
}

// 列表里已经带注解：注解是 markdown 的文章，Halo 本来就会用 Markdown 编辑器打开，
// 直接缓存即可，省掉打开时再请求文章 + 快照。只有注解不是 markdown 的才需要核对快照。
watch(
  filteredPosts,
  (posts) => {
    for (const item of posts) {
      const name = item.post.metadata.name;
      if (isMarkdownPost(item) && !cachedEditorKind(name)) {
        rememberEditorKind(name, "markdown");
      }
    }
  },
  { immediate: true },
);

if (selectedName.value) {
  void prepareEditor(selectedName.value);
}

let selectRefreshTimer: number | undefined;

function selectPost(name: string) {
  const changed = selectedName.value !== name;
  pendingCategory.value = null;
  pendingMarkdown.value = false;
  blankOpen.value = false;
  selectedName.value = name;
  void prepareEditor(name);
  if (route.query.name !== name) {
    void router.replace({ query: { ...route.query, name } });
  }
  if (changed) {
    // 列表刷新要拉全量文章，等编辑器把新文章挂载完再做，别和打开抢网络/主线程
    window.clearTimeout(selectRefreshTimer);
    selectRefreshTimer = window.setTimeout(() => void refreshSilently(), 1200);
  }
}

function createPost(categoryName?: string, editor: PostEditorTarget = "html") {
  pendingCategory.value = categoryName ?? null;
  pendingMarkdown.value = editor === "markdown";
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
    const markdown = pendingMarkdown.value;
    selectedName.value = name;
    blankOpen.value = false;
    pendingCategory.value = null;
    pendingMarkdown.value = false;
    void router.replace({ query: { ...route.query, name } });
    if (wasBlank && (category || markdown)) {
      try {
        if (category) {
          await patchPostField(name, "/spec/categories", [category]);
        }
        if (markdown) {
          await switchPostEditor(name, "markdown");
        }
        await editorRef.value?.reloadCurrent();
      } catch (e) {
        Toast.error(e instanceof Error ? e.message : "设置新文章失败");
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
    return [
      { id: "new-post", label: "在此分类新建文章（富文本）", icon: icons.create },
      { id: "new-post-md", label: "在此分类新建文章（Markdown）", icon: icons.markdown },
      { id: "new-child", label: "在其下新建子分类", icon: icons.folder, divided: true },
      { id: "new-sibling", label: "在其上新建同级分类", icon: icons.folder },
    ];
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
    postIsMarkdown(post)
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

async function moveCategoryTo(payload: {
  name: string;
  parent: string | null;
  index: number;
  message: string;
}) {
  const { name, parent, index, message } = payload;
  const siblings = (
    parent ? findCategoryNode(categoryTree.value, parent)?.children ?? [] : categoryTree.value
  ).filter((node) => node.name !== name);
  const prev = siblings[index - 1];
  const next = siblings[index];
  try {
    if (prev && next && next.priority - prev.priority < 2) {
      // 相邻两个序号之间挤不出空位了，把这一组兄弟整体重排成 0、10、20……
      const ordered = [...siblings.slice(0, index), undefined, ...siblings.slice(index)];
      for (const [slot, node] of ordered.entries()) {
        if (node && node.priority !== slot * 10) {
          await moveCategory(node.name, slot * 10, node.parent ?? null);
        }
      }
      await moveCategory(name, index * 10, parent);
    } else {
      const priority =
        prev && next
          ? Math.floor((prev.priority + next.priority) / 2)
          : prev
            ? prev.priority + 10
            : next
              ? next.priority - 10
              : 0;
      await moveCategory(name, priority, parent);
    }
    Toast.success(`已${message}`);
    await refreshSilently();
  } catch (e) {
    Toast.error(e instanceof Error ? e.message : "移动分类失败");
    await refreshSilently();
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

const catDialog = ref<{ open: boolean; mode: "child" | "sibling"; node?: CatNode }>({
  open: false,
  mode: "child",
});

function closeCatDialog() {
  catDialog.value = { open: false, mode: "child" };
}

function categoryPath(name?: string) {
  if (!name) {
    return "";
  }
  const visit = (nodes: CatNode[], path: string[]): string | undefined => {
    for (const node of nodes) {
      const next = [...path, node.displayName];
      if (node.name === name) {
        return next.join(" / ");
      }
      const found = visit(node.children, next);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  return visit(categoryTree.value, []) ?? "";
}

const catDialogParent = computed(() =>
  catDialog.value.mode === "child" ? catDialog.value.node?.name : catDialog.value.node?.parent,
);

async function confirmCreateCategory(payload: { displayName: string; slug: string }) {
  const parentName = catDialogParent.value;
  closeCatDialog();
  try {
    const name = await createCategory(payload.displayName, payload.slug, parentName);
    Toast.success(`已创建分类「${payload.displayName}」`);
    await refreshSilently();
    if (name) {
      treeRef.value?.expandAncestors(name);
    }
  } catch (e) {
    Toast.error(e instanceof Error ? e.message : "创建分类失败");
  }
}

async function openSettings(name: string) {
  selectPost(name);
  await nextTick();
  const ok = await editorRef.value?.clickHeaderButton(["设置", "Settings"]);
  if (!ok) {
    Toast.warning("请在编辑器右上角点击「设置」");
  }
}

async function confirmSwitchEditor(post: ListedPost) {
  const name = post.post.metadata.name;
  // 以实际内容格式为准决定「切到哪边」，免得把 Markdown 源码当 HTML 再转一遍
  let kind: "markdown" | "html" = postIsMarkdown(post) ? "markdown" : "html";
  try {
    kind = await resolveEditorKind(name);
  } catch {
    // 读不到就按本地判断
  }
  const target: PostEditorTarget = kind === "markdown" ? "html" : "markdown";
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
        await switchPostEditor(name, target);
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
      createPost(target.node.name, "html");
    } else if (id === "new-post-md") {
      createPost(target.node.name, "markdown");
    } else if (id === "new-child" || id === "new-sibling") {
      catDialog.value = { open: true, mode: id === "new-child" ? "child" : "sibling", node: target.node };
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
      await confirmSwitchEditor(post);
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
  // 停用期间不再轮询，回到页面时补一次刷新
  if (!viewActive.value) {
    void refreshSilently();
  }
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
  if (!viewActive.value) {
    return;
  }
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
    if (viewActive.value && document.visibilityState === "visible" && !loading.value) {
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
  window.clearTimeout(selectRefreshTimer);
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
      @move-category="moveCategoryTo($event)"
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
        :hold="resolvingEditor"
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

    <CategoryFormDialog
      :open="catDialog.open"
      :title="catDialog.mode === 'child' ? '新建子分类' : '新建同级分类'"
      :parent-label="categoryPath(catDialogParent)"
      :taken-slugs="categorySlugs"
      @close="closeCatDialog"
      @confirm="confirmCreateCategory"
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
