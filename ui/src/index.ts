import { IconRiPencilFill } from "@halo-dev/components";
import { definePlugin } from "@halo-dev/ui-shared";
import { defineAsyncComponent, markRaw } from "vue";
import { setupPostsOverride } from "./bootstrap";
import { MARKDOWN_EDITOR_NAME } from "./editorMeta";
import "./styles/workbench.css";

setupPostsOverride();

export default definePlugin({
  extensionPoints: {
    "editor:create": () => [
      {
        name: MARKDOWN_EDITOR_NAME,
        displayName: "Markdown",
        logo: "/plugins/post-workbench/assets/ui/editor-markdown.svg",
        component: markRaw(
          defineAsyncComponent(() => import("./components/MarkdownEditor.vue")),
        ),
        rawType: "markdown",
      },
    ],
  },
  routes: [
    {
      parentName: "Root",
      route: {
        path: "/workbench",
        name: "PostWorkbench",
        component: defineAsyncComponent(
          () => import("./views/WorkbenchView.vue"),
        ),
        meta: {
          title: "写作台",
          searchable: true,
          permissions: ["system:posts:view"],
          hideFooter: true,
          menu: {
            name: "写作台",
            group: "content",
            icon: markRaw(IconRiPencilFill),
            priority: 1,
          },
        },
      },
    },
  ],
});
