<script setup lang="ts">
import { IconClose } from "@halo-dev/components";
import { computed, ref, watch } from "vue";
import type { CatNode } from "../composables/useContent";

const props = defineProps<{
  open: boolean;
  title: string;
  tree: CatNode[];
  selected: string[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm", names: string[]): void;
}>();

interface CheckRow {
  node: CatNode;
  depth: number;
}

const checked = ref(new Set<string>());
const expanded = ref(new Set<string>());

function flatten(nodes: CatNode[], depth: number, result: CheckRow[] = []) {
  for (const node of nodes) {
    result.push({ node, depth });
    if (expanded.value.has(node.name)) {
      flatten(node.children, depth + 1, result);
    }
  }
  return result;
}

const rows = computed(() => flatten(props.tree, 0));

function allNames(nodes: CatNode[], result: string[] = []) {
  for (const node of nodes) {
    result.push(node.name);
    allNames(node.children, result);
  }
  return result;
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }
    checked.value = new Set(props.selected);
    expanded.value = new Set(allNames(props.tree));
  },
);

function toggleCheck(name: string) {
  const next = new Set(checked.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  checked.value = next;
}

function toggleExpand(name: string) {
  const next = new Set(expanded.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  expanded.value = next;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="wb-modal-backdrop" @click.self="emit('close')">
      <div class="wb-modal">
        <header class="wb-modal__head">
          <h3>{{ title }}</h3>
          <button class="wb-icon-btn" @click="emit('close')">
            <IconClose />
          </button>
        </header>
        <div class="wb-modal__body">
          <div v-if="!rows.length" class="wb-modal__empty">还没有分类，可在控制台「文章 - 分类」中创建。</div>
          <div
            v-for="row in rows"
            :key="row.node.name"
            class="wb-check-row"
            :style="{ paddingLeft: `${10 + row.depth * 18}px` }"
          >
            <button
              class="wb-caret"
              :class="{ 'is-open': expanded.has(row.node.name), 'is-empty': !row.node.children.length }"
              @click="toggleExpand(row.node.name)"
            ></button>
            <label class="wb-check">
              <input
                type="checkbox"
                :checked="checked.has(row.node.name)"
                @change="toggleCheck(row.node.name)"
              />
              <span class="wb-check__box"></span>
              <span class="wb-check__label">{{ row.node.displayName }}</span>
            </label>
            <span class="wb-row__count">{{ row.node.count }}</span>
          </div>
          <p class="wb-modal__hint">不勾选任何分类时，文章会归入「未分类」。</p>
        </div>
        <footer class="wb-modal__foot">
          <button class="wb-btn" @click="emit('close')">取消</button>
          <button class="wb-btn is-primary" @click="emit('confirm', Array.from(checked))">确定</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
