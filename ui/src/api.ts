import type { CategoryTreeNode, ListedPost } from "@halo-dev/api-client";
import { consoleApiClient } from "@halo-dev/api-client";

const NOT_DELETED = ["content.halo.run/deleted=false"];

export const BLANK_EDITOR_PATH = "/console/posts/editor";

export function editorPath(name: string) {
  return `${BLANK_EDITOR_PATH}?name=${encodeURIComponent(name)}`;
}

export async function fetchAllPosts(): Promise<ListedPost[]> {
  const size = 100;
  const query = (page: number) =>
    consoleApiClient.content.post.listPosts({
      page,
      size,
      labelSelector: NOT_DELETED,
      sort: ["metadata.creationTimestamp,desc"],
    });

  const first = await query(1);
  const items = [...first.data.items];
  const total = first.data.total ?? items.length;
  const pages = Math.min(Math.ceil(total / size), 50);
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) => query(index + 2)),
    );
    for (const response of rest) {
      items.push(...response.data.items);
    }
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const name = item.post.metadata.name;
    if (seen.has(name)) {
      return false;
    }
    seen.add(name);
    return true;
  });
}

export async function fetchCategoryTree(): Promise<CategoryTreeNode[]> {
  const { data } = await consoleApiClient.content.category.listCategoryTree();
  return data;
}

export async function fetchPluginConfig(): Promise<Record<string, Record<string, unknown>>> {
  try {
    const response = await fetch(
      "/apis/api.console.halo.run/v1alpha1/plugins/post-workbench/json-config",
      { headers: { Accept: "application/json" }, credentials: "include" },
    );
    if (!response.ok) {
      return {};
    }
    return ((await response.json()) as Record<string, Record<string, unknown>>) ?? {};
  } catch {
    return {};
  }
}

export async function publishPost(name: string) {
  await consoleApiClient.content.post.publishPost({ name });
}

export async function unpublishPost(name: string) {
  await consoleApiClient.content.post.unpublishPost({ name });
}

export async function recyclePost(name: string) {
  await consoleApiClient.content.post.recyclePost({ name });
}

export async function patchPostField(name: string, path: string, value: unknown) {
  const response = await fetch(`/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(name)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify([{ op: "add", path, value }]),
  });
  if (!response.ok) {
    throw new Error(`更新失败 (${response.status})`);
  }
}
