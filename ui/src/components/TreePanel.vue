<script setup lang="ts">
import type { ListedPost } from "@halo-dev/api-client";
import {
  IconArrowLeft,
  IconBookRead,
  IconClose,
  IconFolder,
  IconGrid,
  IconRefreshLine,
  IconSearch,
} from "@halo-dev/components";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CatNode, StatusFilter } from "../composables/useContent";
import { postPhase } from "../composables/useContent";
import { formatDateTime, relativeTime } from "../utils";

interface Row {
  id: string;
  kind: "special" | "cat" | "post";
  depth: number;
  label: string;
  count?: number;
  special?: "all" | "uncategorized";
  category?: CatNode;
  post?: ListedPost;
}

const props = defineProps<{
  categoryTree: CatNode[];
  posts: ListedPost[];
  uncategorized: ListedPost[];
  counts: { all: number; published: number; draft: number; scheduled: number };
  statusFilter: StatusFilter;
  loading: boolean;
  error: string;
  selectedName?: string;
  consoleHidden: boolean;
}>();

const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "create", categoryName?: string): void;
  (
    e: "context-menu",
    payload: {
      x: number;
      y: number;
      kind: "post" | "category";
      post?: ListedPost;
      node?: CatNode;
    },
  ): void;
  (e: "update:statusFilter", value: StatusFilter): void;
  (e: "refresh"): void;
  (e: "collapse"): void;
  (e: "toggle-console"): void;
}>();

const ALL_KEY = "__all__";
const UNCATEGORIZED_KEY = "__uncategorized__";

const bodyRef = ref<HTMLElement>();
const searchRef = ref<HTMLInputElement>();
const searchInput = ref("");
const search = ref("");
const expanded = ref(new Set<string>());
const activeId = ref<string>();

let searchTimer: number | undefined;
watch(searchInput, (value) => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    search.value = value;
  }, 120);
});

const initializedRoots = ref(false);
watch(
  () => props.categoryTree,
  (tree) => {
    if (initializedRoots.value || !tree.length) {
      return;
    }
    initializedRoots.value = true;
    const next = new Set(expanded.value);
    for (const node of tree) {
      next.add(`c:${node.name}`);
    }
    expanded.value = next;
  },
  { immediate: true },
);

const statusLabel: Record<string, string> = {
  published: "已发布",
  draft: "草稿",
  scheduled: "定时",
};

function isExpanded(key: string) {
  return expanded.value.has(key);
}

function toggle(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expanded.value = next;
}

function postRow(post: ListedPost, depth: number, parentKey: string): Row {
  return {
    id: `p:${parentKey}:${post.post.metadata.name}`,
    kind: "post",
    depth,
    label: post.post.spec.title || "无标题",
    post,
  };
}

function categoryPath(post: ListedPost) {
  const names = post.categories?.map((category) => category.spec?.displayName ?? category.metadata.name);
  return names?.length ? names.join(" / ") : "未分类";
}

function walk(nodes: CatNode[], depth: number, result: Row[]) {
  for (const node of nodes) {
    const key = `c:${node.name}`;
    result.push({
      id: key,
      kind: "cat",
      depth,
      label: node.displayName,
      count: node.count,
      category: node,
    });
    if (isExpanded(key)) {
      walk(node.children, depth + 1, result);
      for (const post of node.posts) {
        result.push(postRow(post, depth + 1, key));
      }
    }
  }
}

function matches(post: ListedPost, keyword: string) {
  const spec = post.post.spec;
  return [spec.title, spec.slug, post.post.status?.excerpt]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(keyword));
}

const rows = computed<Row[]>(() => {
  const keyword = search.value.trim().toLowerCase();
  if (keyword) {
    return props.posts
      .filter((post) => matches(post, keyword))
      .map((post) => ({ ...postRow(post, 0, "search"), id: `s:${post.post.metadata.name}` }));
  }

  const result: Row[] = [];
  result.push({
    id: ALL_KEY,
    kind: "special",
    special: "all",
    depth: 0,
    label: "全部文章",
    count: props.posts.length,
  });
  if (isExpanded(ALL_KEY)) {
    for (const post of props.posts) {
      result.push(postRow(post, 1, ALL_KEY));
    }
  }

  walk(props.categoryTree, 0, result);

  result.push({
    id: UNCATEGORIZED_KEY,
    kind: "special",
    special: "uncategorized",
    depth: 0,
    label: "未分类",
    count: props.uncategorized.length,
  });
  if (isExpanded(UNCATEGORIZED_KEY)) {
    for (const post of props.uncategorized) {
      result.push(postRow(post, 1, UNCATEGORIZED_KEY));
    }
  }
  return result;
});

watch(
  rows,
  (list) => {
    if (!list.length) {
      activeId.value = undefined;
      return;
    }
    if (!list.some((row) => row.id === activeId.value)) {
      activeId.value = list[0].id;
    }
  },
  { immediate: true },
);

function findCategory(categoryName?: string) {
  if (!categoryName) {
    return undefined;
  }
  let found: CatNode | undefined;
  const visit = (nodes: CatNode[]) => {
    for (const node of nodes) {
      if (node.name === categoryName) {
        found = node;
        return;
      }
      visit(node.children);
    }
  };
  visit(props.categoryTree);
  return found;
}

function expandAncestors(categoryName?: string) {
  const next = new Set(expanded.value);
  let node = findCategory(categoryName);
  while (node) {
    next.add(`c:${node.name}`);
    node = node.parent ? findCategory(node.parent) : undefined;
  }
  expanded.value = next;
}

watch(
  [() => props.selectedName, () => props.posts] as const,
  async ([name]) => {
    if (!name) {
      return;
    }
    const post = props.posts.find((item) => item.post.metadata.name === name);
    if (post) {
      const categories = post.post.spec.categories ?? [];
      if (categories.length) {
        expandAncestors(categories[0]);
      } else {
        const next = new Set(expanded.value);
        next.add(UNCATEGORIZED_KEY);
        expanded.value = next;
      }
    }
    await nextTick();
    scrollToSelected(name);
  },
);

function scrollToSelected(name: string) {
  bodyRef.value
    ?.querySelector(`[data-post-name="${name}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function activateRow(row: Row) {
  if (row.kind === "post" && row.post) {
    emit("select", row.post.post.metadata.name);
  } else {
    toggle(row.id);
  }
}

function scrollActive() {
  if (!activeId.value) {
    return;
  }
  bodyRef.value
    ?.querySelector(`[data-row-id="${activeId.value}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
    return;
  }
  const list = rows.value;
  if (!list.length) {
    return;
  }
  const index = list.findIndex((row) => row.id === activeId.value);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeId.value = list[Math.min(list.length - 1, index + 1)].id;
    hideHover();
    scrollActive();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeId.value = list[Math.max(0, index - 1)].id;
    hideHover();
    scrollActive();
  } else if (event.key === "Enter") {
    const row = list[index];
    if (row) {
      activateRow(row);
    }
  } else if (event.key === "ArrowRight") {
    const row = list[index];
    if (row && row.kind !== "post" && !isExpanded(row.id)) {
      toggle(row.id);
    }
  } else if (event.key === "ArrowLeft") {
    const row = list[index];
    if (row && row.kind !== "post" && isExpanded(row.id)) {
      toggle(row.id);
    }
  }
}

function focusSearch() {
  searchRef.value?.focus();
  searchRef.value?.select();
}

defineExpose({ focusSearch });

const hover = ref<{ post: ListedPost; top: number; left: number } | null>(null);
let hoverTimer: number | undefined;

function hideHover() {
  window.clearTimeout(hoverTimer);
  hover.value = null;
}

function onRowEnter(event: MouseEvent, row: Row) {
  if (!row.post) {
    hideHover();
    return;
  }
  window.clearTimeout(hoverTimer);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const post = row.post;
  hoverTimer = window.setTimeout(() => {
    const width = 340;
    const margin = 12;
    let left = rect.right + 10;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, Math.min(rect.left - width - 10, window.innerWidth - width - margin));
    }
    let top = rect.top - 8;
    top = Math.min(top, window.innerHeight - 190 - margin);
    top = Math.max(margin, top);
    hover.value = { post, top, left };
  }, 320);
}

function openMenu(event: MouseEvent, row: Row) {
  event.preventDefault();
  event.stopPropagation();
  hideHover();
  if (row.kind === "post" && row.post) {
    emit("context-menu", {
      x: event.clientX,
      y: event.clientY,
      kind: "post",
      post: row.post,
    });
  } else if (row.kind === "cat" && row.category) {
    emit("context-menu", {
      x: event.clientX,
      y: event.clientY,
      kind: "category",
      node: row.category,
    });
  }
}

function openMenuFromButton(event: MouseEvent, row: Row) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  hideHover();
  if (row.kind === "post" && row.post) {
    emit("context-menu", {
      x: rect.right,
      y: rect.bottom + 4,
      kind: "post",
      post: row.post,
    });
  } else if (row.kind === "cat" && row.category) {
    emit("context-menu", {
      x: rect.right,
      y: rect.bottom + 4,
      kind: "category",
      node: row.category,
    });
  }
}

const chips: Array<{ value: StatusFilter; label: string; countKey: keyof typeof props.counts }> = [
  { value: "all", label: "全部", countKey: "all" },
  { value: "published", label: "已发布", countKey: "published" },
  { value: "draft", label: "草稿", countKey: "draft" },
  { value: "scheduled", label: "定时", countKey: "scheduled" },
];

onMounted(() => {
  window.addEventListener("mousedown", hideHover, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("mousedown", hideHover, true);
  window.clearTimeout(searchTimer);
});
</script>

<template>
  <aside class="wb-tree">
    <div class="wb-tree__head">
      <div class="wb-search">
        <IconSearch class="wb-search__icon" />
        <input
          ref="searchRef"
          v-model="searchInput"
          class="wb-search__input"
          placeholder="搜索文章…"
          @keydown.esc="searchInput = ''"
        />
        <button v-if="searchInput" class="wb-icon-btn wb-search__clear" title="清空" @click="searchInput = ''">
          <IconClose />
        </button>
      </div>
      <div class="wb-tree__actions">
        <button class="wb-new-btn" @click="emit('create')">＋ 新建</button>
        <button class="wb-icon-btn" title="刷新" @click="emit('refresh')">
          <IconRefreshLine />
        </button>
        <button
          class="wb-icon-btn"
          :class="{ 'is-active': consoleHidden }"
          :title="consoleHidden ? '显示控制台导航' : '隐藏控制台导航'"
          @click="emit('toggle-console')"
        >
          <IconGrid />
        </button>
        <button class="wb-icon-btn" title="收起分类栏" @click="emit('collapse')">
          <IconArrowLeft />
        </button>
      </div>
    </div>

    <div class="wb-chips">
      <button
        v-for="chip in chips"
        :key="chip.value"
        class="wb-chip"
        :class="{ 'is-active': statusFilter === chip.value }"
        @click="emit('update:statusFilter', chip.value)"
      >
        {{ chip.label }}
        <span class="wb-chip__count">{{ counts[chip.countKey] }}</span>
      </button>
    </div>

    <div ref="bodyRef" class="wb-tree__body" tabindex="0" @keydown="onKeydown" @scroll="hideHover">
      <div v-if="error" class="wb-tree__state">
        <p>加载失败</p>
        <button class="wb-link" @click="emit('refresh')">重试</button>
      </div>

      <template v-else-if="loading && !posts.length">
        <div v-for="index in 8" :key="index" class="wb-skeleton"></div>
      </template>

      <div v-else-if="!rows.length" class="wb-tree__state">
        <p>没有匹配的文章</p>
      </div>

      <template v-else>
        <div
          v-for="row in rows"
          :key="row.id"
          class="wb-row"
          :class="{
            'is-selected': row.post && row.post.post.metadata.name === selectedName,
            'is-active': row.id === activeId,
            'is-folder': row.kind !== 'post',
            'is-published': row.post && postPhase(row.post.post) === 'published',
            'is-draft': row.post && postPhase(row.post.post) === 'draft',
            'is-scheduled': row.post && postPhase(row.post.post) === 'scheduled',
          }"
          :data-row-id="row.id"
          :data-post-name="row.post?.post.metadata.name"
          :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
          @click="activateRow(row)"
          @mouseenter="onRowEnter($event, row)"
          @mouseleave="hideHover"
          @contextmenu="openMenu($event, row)"
        >
          <template v-if="row.kind !== 'post'">
            <span class="wb-caret" :class="{ 'is-open': isExpanded(row.id) }" @click.stop="toggle(row.id)"></span>
            <component :is="row.special === 'all' ? IconBookRead : IconFolder" class="wb-folder" />
            <span class="wb-row__title">{{ row.label }}</span>
            <span class="wb-row__count">{{ row.count }}</span>
          </template>
          <template v-else>
            <span class="wb-dot"></span>
            <span class="wb-row__title">{{ row.label }}</span>
            <span v-if="row.post?.post.spec.pinned" class="wb-pin" title="置顶">▲</span>
            <span v-if="search" class="wb-row__path">{{ row.post ? categoryPath(row.post) : "" }}</span>
            <span v-else class="wb-row__time">
              {{ relativeTime(row.post?.post.metadata.creationTimestamp) }}
            </span>
            <button class="wb-row__more" title="操作" @click.stop="openMenuFromButton($event, row)">
              ⋯
            </button>
          </template>
        </div>
      </template>
    </div>

    <div class="wb-tree__foot">
      <span>共 {{ counts.all }} 篇</span>
      <span>已发布 {{ counts.published }}</span>
      <span>草稿 {{ counts.draft }}</span>
      <span v-if="counts.scheduled">定时 {{ counts.scheduled }}</span>
    </div>

    <Teleport to="body">
      <div v-if="hover" class="wb-hover" :style="{ top: `${hover.top}px`, left: `${hover.left}px` }">
        <div class="wb-hover__title">{{ hover.post.post.spec.title || "无标题" }}</div>
        <div class="wb-hover__excerpt">
          {{ hover.post.post.status?.excerpt || "暂无摘要，打开编辑器保存后会自动生成。" }}
        </div>
        <div class="wb-hover__meta">
          <span class="wb-status" :class="`is-${postPhase(hover.post.post)}`">
            {{ statusLabel[postPhase(hover.post.post)] }}
          </span>
          <span>{{ categoryPath(hover.post) }}</span>
          <span>{{ formatDateTime(hover.post.post.metadata.creationTimestamp) }}</span>
        </div>
      </div>
    </Teleport>
  </aside>
</template>
