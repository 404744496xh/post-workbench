<script setup lang="ts">
import { IconClose } from "@halo-dev/components";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  parentLabel: string;
  takenSlugs: string[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm", payload: { displayName: string; slug: string }): void;
}>();

const displayName = ref("");
const slug = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      displayName.value = "";
      slug.value = "";
    }
  },
);

const finalSlug = computed(() => slug.value.trim() || displayName.value.trim());
const slugTaken = computed(
  () => finalSlug.value.length > 0 && props.takenSlugs.includes(finalSlug.value),
);
const canSubmit = computed(() => displayName.value.trim().length > 0 && !slugTaken.value);

function submit() {
  const name = displayName.value.trim();
  if (!name || slugTaken.value) {
    return;
  }
  emit("confirm", { displayName: name, slug: finalSlug.value });
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
          <p class="wb-modal__hint">父级：{{ parentLabel || "顶级分类" }}</p>
          <label class="wb-field">
            <span class="wb-field__label">名称</span>
            <input
              v-model="displayName"
              class="wb-field__input"
              type="text"
              placeholder="分类显示名称"
              @keyup.enter="submit"
            />
          </label>
          <label class="wb-field">
            <span class="wb-field__label">别名</span>
            <input
              v-model="slug"
              class="wb-field__input"
              type="text"
              placeholder="留空则使用名称，用于 /categories/xxx 链接"
              @keyup.enter="submit"
            />
          </label>
          <p v-if="slugTaken" class="wb-modal__hint">别名「{{ finalSlug }}」已被其他分类占用，请换一个。</p>
        </div>
        <footer class="wb-modal__foot">
          <button class="wb-btn" @click="emit('close')">取消</button>
          <button class="wb-btn is-primary" :disabled="!canSubmit" @click="submit">创建</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
