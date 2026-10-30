import type { ListedPost } from "@halo-dev/api-client";
import type { Component } from "vue";
import type { CatNode } from "./composables/useContent";

export interface MenuItem {
  id: string;
  label: string;
  icon?: Component;
  danger?: boolean;
  disabled?: boolean;
  divided?: boolean;
}

export type MenuTarget =
  | { kind: "post"; post: ListedPost }
  | { kind: "category"; node: CatNode };
