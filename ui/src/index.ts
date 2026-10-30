import { IconRiPencilFill } from "@halo-dev/components";
import { definePlugin } from "@halo-dev/ui-shared";
import { defineAsyncComponent, markRaw } from "vue";
import "./styles/workbench.css";

export default definePlugin({
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
