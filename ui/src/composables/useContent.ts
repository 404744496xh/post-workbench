import type { CategoryTreeNode, ListedPost, Post } from "@halo-dev/api-client";
import { computed, ref, shallowRef } from "vue";
import { fetchAllPosts, fetchCategoryTree } from "../api";

export type StatusFilter = "all" | "published" | "draft" | "scheduled";
export type PostPhase = Exclude<StatusFilter, "all">;

export interface CatNode {
  name: string;
  displayName: string;
  parent?: string;
  children: CatNode[];
  posts: ListedPost[];
  count: number;
}

export function postPhase(post: Post): PostPhase {
  if (!post.spec.publish) {
    return "draft";
  }
  if (post.spec.publishTime && Date.parse(post.spec.publishTime) > Date.now()) {
    return "scheduled";
  }
  return "published";
}

function buildTree(nodes: CategoryTreeNode[] | undefined, posts: ListedPost[]): CatNode[] {
  return (nodes ?? []).map((node) => {
    const name = node.category.metadata.name;
    const own = posts.filter((item) => item.post.spec.categories?.includes(name));
    const children = buildTree(node.children, posts);
    return {
      name,
      displayName: node.category.spec.displayName || name,
      parent: node.category.spec.parent,
      children,
      posts: own,
      count: own.length + children.reduce((sum, child) => sum + child.count, 0),
    };
  });
}

export function useContent() {
  const allPosts = shallowRef<ListedPost[]>([]);
  const rawTree = shallowRef<CategoryTreeNode[]>([]);
  const loading = ref(true);
  const error = ref("");
  const statusFilter = ref<StatusFilter>("all");
  let requestSeq = 0;

  async function refresh(options: { silent?: boolean } = {}) {
    const seq = ++requestSeq;
    if (!options.silent) {
      loading.value = true;
    }
    error.value = "";
    try {
      const [tree, posts] = await Promise.all([fetchCategoryTree(), fetchAllPosts()]);
      if (seq !== requestSeq) {
        return;
      }
      rawTree.value = tree;
      allPosts.value = posts;
    } catch (e) {
      if (seq !== requestSeq) {
        return;
      }
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      if (seq === requestSeq) {
        loading.value = false;
      }
    }
  }

  const filteredPosts = computed(() => {
    if (statusFilter.value === "all") {
      return allPosts.value;
    }
    return allPosts.value.filter((item) => postPhase(item.post) === statusFilter.value);
  });

  const categoryTree = computed(() => buildTree(rawTree.value, filteredPosts.value));

  const uncategorized = computed(() =>
    filteredPosts.value.filter((item) => !item.post.spec.categories?.length),
  );

  const counts = computed(() => {
    const result = { all: allPosts.value.length, published: 0, draft: 0, scheduled: 0 };
    for (const item of allPosts.value) {
      result[postPhase(item.post)] += 1;
    }
    return result;
  });

  function findPost(name?: string | null) {
    if (!name) {
      return undefined;
    }
    return allPosts.value.find((item) => item.post.metadata.name === name);
  }

  return {
    allPosts,
    loading,
    error,
    statusFilter,
    filteredPosts,
    categoryTree,
    uncategorized,
    counts,
    refresh,
    findPost,
  };
}
