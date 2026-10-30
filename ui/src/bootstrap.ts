import { fetchPluginConfig } from "./api";

const BYPASS_KEY = "post-workbench:native-posts";
const SETTINGS_TTL = 30_000;

let cached: { value: boolean; at: number } | undefined;
let pill: HTMLButtonElement | undefined;

export async function isOverridePostsEnabled(force = false): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < SETTINGS_TTL) {
    return cached.value;
  }
  const config = await fetchPluginConfig();
  const value = Boolean(config.basic?.overridePosts ?? config.overridePosts ?? false);
  cached = { value, at: Date.now() };
  return value;
}

export function bypassNativePosts() {
  sessionStorage.setItem(BYPASS_KEY, "1");
}

function getRouter(): any {
  return (document.querySelector("#app") as any)?.__vue_app__?.config?.globalProperties?.$router;
}

function syncWorkbenchMenu(hidden: boolean) {
  document.querySelectorAll("aside.sidebar li.menu-item").forEach((item) => {
    if (item.textContent?.trim() === "写作台") {
      item.classList.toggle("wb-menu-hidden", hidden);
    }
  });
}

function syncPill(router: any, show: boolean) {
  if (!show) {
    pill?.remove();
    pill = undefined;
    return;
  }
  if (pill) {
    return;
  }
  pill = document.createElement("button");
  pill.type = "button";
  pill.className = "wb-native-pill";
  pill.textContent = "写作台视图";
  pill.title = "回到写作台";
  pill.addEventListener("click", () => {
    sessionStorage.removeItem(BYPASS_KEY);
    void router.push("/workbench");
  });
  document.body.appendChild(pill);
}

export function setupPostsOverride() {
  let attempts = 0;
  const install = () => {
    const router = getRouter();
    if (!router) {
      if (attempts++ < 200) {
        window.setTimeout(install, 300);
      }
      return;
    }
    router.beforeEach(async (to: any) => {
      if (to.path !== "/posts") {
        return true;
      }
      if (!(await isOverridePostsEnabled())) {
        return true;
      }
      if (sessionStorage.getItem(BYPASS_KEY) === "1") {
        return true;
      }
      return { path: "/workbench" };
    });
    router.afterEach(async (to: any) => {
      const enabled = await isOverridePostsEnabled();
      syncWorkbenchMenu(enabled);
      if (to.path !== "/posts") {
        sessionStorage.removeItem(BYPASS_KEY);
        syncPill(router, false);
        return;
      }
      syncPill(router, enabled);
    });
    void (async () => {
      await router.isReady?.();
      const enabled = await isOverridePostsEnabled(true);
      syncWorkbenchMenu(enabled);
      if (!enabled) {
        return;
      }
      const current = router.currentRoute.value;
      if (current.path === "/posts" && sessionStorage.getItem(BYPASS_KEY) !== "1") {
        await router.replace("/workbench");
      }
    })();
  };
  install();
}
