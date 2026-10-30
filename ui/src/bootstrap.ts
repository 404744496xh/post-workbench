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
  localStorage.setItem(BYPASS_KEY, "1");
}

function useNativePosts() {
  return localStorage.getItem(BYPASS_KEY) === "1";
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
    localStorage.removeItem(BYPASS_KEY);
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
      if (useNativePosts()) {
        return true;
      }
      return { path: "/workbench" };
    });
    const syncChrome = async (path: string) => {
      const enabled = await isOverridePostsEnabled();
      syncWorkbenchMenu(enabled);
      if (path === "/workbench") {
        // 真正回到写作台，视为改回写作台视图
        localStorage.removeItem(BYPASS_KEY);
      }
      syncPill(router, path === "/posts" && enabled);
    };
    router.afterEach((to: any) => void syncChrome(to.path));
    void (async () => {
      await router.isReady?.();
      if ((await isOverridePostsEnabled(true)) && router.currentRoute.value.path === "/posts" && !useNativePosts()) {
        await router.replace("/workbench");
      }
      // 冷启动的首次导航不会触发 afterEach，按最终路由补一次
      await syncChrome(router.currentRoute.value.path);
    })();
  };
  install();
}
