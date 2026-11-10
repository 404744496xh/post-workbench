import type { ListedPost, Post } from "@halo-dev/api-client";
import { consoleApiClient, coreApiClient } from "@halo-dev/api-client";
import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { patchPostField } from "./api";
import {
  MARKDOWN_EDITOR_NAME,
  PREFERRED_EDITOR_ANNOTATION,
  RICH_EDITOR_NAME,
  type PostEditorTarget,
} from "./editorMeta";

export type EditorKind = "markdown" | "html";

const editorKinds = new Map<string, EditorKind>();

export function cachedEditorKind(name: string) {
  return editorKinds.get(name);
}

export function rememberEditorKind(name: string, kind: EditorKind) {
  editorKinds.set(name, kind);
}

/**
 * 打开文章前确认它实际该用哪个编辑器。Halo 是按 preferred-editor 注解挑编辑器的，
 * 注解指向富文本但正文其实是 Markdown 时，富文本会把源码当 HTML 渲染 —— 所以以
 * head 快照的 rawType 为准，并把注解纠正过来。
 */
export async function resolveEditorKind(name: string): Promise<EditorKind> {
  const cached = editorKinds.get(name);
  if (cached) {
    return cached;
  }
  const response = await fetch(
    `/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(name)}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`读取文章失败 (${response.status})`);
  }
  const post = (await response.json()) as Post;
  const annotation = post.metadata.annotations?.[PREFERRED_EDITOR_ANNOTATION];
  let kind: EditorKind = annotation === MARKDOWN_EDITOR_NAME ? "markdown" : "html";
  const snapshotName = post.spec?.headSnapshot;
  if (snapshotName) {
    const snapshotResponse = await fetch(
      `/apis/content.halo.run/v1alpha1/snapshots/${encodeURIComponent(snapshotName)}`,
      { credentials: "include" },
    );
    if (snapshotResponse.ok) {
      const snapshot = (await snapshotResponse.json()) as { spec?: { rawType?: string } };
      kind = (snapshot.spec?.rawType ?? "").toLowerCase() === "markdown" ? "markdown" : "html";
    }
  }
  if (kind === "markdown" && annotation !== MARKDOWN_EDITOR_NAME) {
    await patchPostField(
      name,
      `/metadata/annotations/${PREFERRED_EDITOR_ANNOTATION.replace("/", "~1")}`,
      MARKDOWN_EDITOR_NAME,
    );
  }
  editorKinds.set(name, kind);
  return kind;
}

export function isMarkdownPost(post: ListedPost) {
  return (
    post.post.metadata.annotations?.[PREFERRED_EDITOR_ANNOTATION] ===
    MARKDOWN_EDITOR_NAME
  );
}

function markdownToHtml(markdown: string) {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
}

async function patchSnapshotRawType(snapshotName: string, rawType: string) {
  const response = await fetch(
    `/apis/content.halo.run/v1alpha1/snapshots/${encodeURIComponent(snapshotName)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json-patch+json" },
      body: JSON.stringify([{ op: "add", path: "/spec/rawType", value: rawType }]),
    },
  );
  if (!response.ok) {
    throw new Error(`更新内容格式失败 (${response.status})`);
  }
}

let turndownService: TurndownService | undefined;

function getTurndown() {
  if (turndownService) {
    return turndownService;
  }
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  service.use(gfm);
  service.keep(["iframe", "video", "audio"]);
  service.addRule("inlineCellParagraph", {
    filter: (node) =>
      node.nodeName === "P" &&
      ["LI", "TH", "TD", "FIGCAPTION"].includes(node.parentNode?.nodeName ?? ""),
    replacement: (content) => content,
  });
  service.addRule("haloImageFigure", {
    filter: (node) =>
      node.nodeName === "FIGURE" &&
      node.getAttribute("data-content-type") === "image",
    replacement: (_content, node) => {
      const img = node.querySelector("img");
      if (!img) {
        return "";
      }
      const alt = img.getAttribute("alt") ?? "";
      const src = img.getAttribute("src") ?? "";
      const caption = node.querySelector("figcaption")?.textContent?.trim();
      const title = caption ? ` "${caption.replace(/"/g, '\\"')}"` : "";
      return `\n\n![${alt}](${src}${title})\n\n`;
    },
  });
  turndownService = service;
  return service;
}

function htmlToMarkdown(html: string) {
  return getTurndown().turndown(html);
}

export async function switchPostEditor(
  name: string,
  target: PostEditorTarget,
) {
  const [{ data }, { data: latest }] = await Promise.all([
    consoleApiClient.content.post.fetchPostHeadContent({ name }),
    coreApiClient.content.post.getPost({ name }),
  ]);

  const raw = data.raw ?? "";
  const currentEditor =
    latest.metadata.annotations?.[PREFERRED_EDITOR_ANNOTATION];
  // 已保存的 head 快照 rawType 可能滞后（后端更新快照时不会改 rawType），优先看注解
  const sourceIsMarkdown =
    currentEditor === MARKDOWN_EDITOR_NAME ||
    (currentEditor !== RICH_EDITOR_NAME &&
      (data.rawType ?? "").toLowerCase() === "markdown");
  let content: { raw: string; content: string; rawType: string } | undefined;

  if (target === "markdown" && !sourceIsMarkdown) {
    const markdown = htmlToMarkdown(raw);
    content = {
      raw: markdown,
      content: markdownToHtml(markdown),
      rawType: "markdown",
    };
  } else if (target === "html" && sourceIsMarkdown) {
    const html = markdownToHtml(raw);
    content = { raw: html, content: html, rawType: "HTML" };
  }

  if (content) {
    const { data: updated } = await consoleApiClient.content.post.updatePostContent(
      { name, content },
    );
    const headSnapshot = updated.spec?.headSnapshot;
    if (headSnapshot) {
      await patchSnapshotRawType(headSnapshot, content.rawType);
    }
  }

  await patchPostField(
    name,
    `/metadata/annotations/${PREFERRED_EDITOR_ANNOTATION.replace("/", "~1")}`,
    target === "markdown" ? MARKDOWN_EDITOR_NAME : RICH_EDITOR_NAME,
  );
  editorKinds.set(name, target);
}
