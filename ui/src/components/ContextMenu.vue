<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { MenuItem } from "../types";

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "close"): void;
}>();

const menuRef = ref<HTMLElement>();
const pos = ref({ left: 0, top: 0 });

watch(
  () => [props.open, props.x, props.y] as const,
  async ([open]) => {
    if (!open) {
      return;
    }
    pos.value = { left: props.x, top: props.y };
    await nextTick();
    const el = menuRef.value;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    let left = props.x;
    let top = props.y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, props.x - rect.width);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    pos.value = { left, top };
  },
  { immediate: true },
);

function select(item: MenuItem) {
  if (item.disabled) {
    return;
  }
  emit("select", item.id);
  emit("close");
}

function onDocumentMouseDown(event: MouseEvent) {
  if (!props.open) {
    return;
  }
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit("close");
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
  }
}

function onViewportChange() {
  if (props.open) {
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocumentMouseDown);
  document.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
  document.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      class="wb-menu"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @contextmenu.prevent
    >
      <template v-for="(item, index) in items" :key="item.id">
        <div v-if="item.divided && index > 0" class="wb-menu__divider"></div>
        <button
          class="wb-menu__item"
          :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }"
          :disabled="item.disabled"
          @click="select(item)"
        >
          <span class="wb-menu__icon">
            <component :is="item.icon" v-if="item.icon" />
          </span>
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
