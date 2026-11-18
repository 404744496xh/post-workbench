// mermaid 体积大（约 1MB gzip），提前预取，打开含图表的文章时直接读缓存
export const MERMAID_SCRIPT_ID = "vditorMermaidScript";
export const MERMAID_SRC = `/plugins/post-workbench/assets/ui/vditor/dist/js/mermaid/mermaid.min.js?v=11.17.2-pw1`;

export function prefetchMermaid() {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData || document.querySelector("link[data-wb-mermaid]")) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "script";
  link.href = MERMAID_SRC;
  link.dataset.wbMermaid = "1";
  document.head.appendChild(link);
}
