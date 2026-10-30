import { computed, readonly, ref } from "vue";
import * as api from "../lib/api";
import { applyAccent, isAccentColor, type AccentColor } from "../lib/accent";
export { accentOptions, type AccentColor } from "../lib/accent";

export type AppearanceMode = "light" | "dark" | "system";
const storageKey = "ssh-go.appearance.mode";
const accentStorageKey = "ssh-go.appearance.accent";
const mode = ref<AppearanceMode>("light");
const accent = ref<AccentColor>("purple");
const systemDark = ref(false);
export const appearanceMode = readonly(mode);
export const accentColor = readonly(accent);
export const isDark = computed(() => mode.value === "dark" || (mode.value === "system" && systemDark.value));
let modeRevision = 0, accentRevision = 0;
let saveQueue = Promise.resolve();
let windowMode: AppearanceMode | undefined;
let windowQueue = Promise.resolve();
function valid(value: unknown): value is AppearanceMode {
  return value === "light" || value === "dark" || value === "system";
}
function apply() {
  const theme = isDark.value ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.body.setAttribute("arco-theme", theme);
  applyAccent(accent.value, isDark.value);
  if (api.desktopAvailable && windowMode !== mode.value) {
    const next = mode.value;
    windowMode = next;
    // Preserve selection order while the desktop is starting up.
    windowQueue = windowQueue.then(() => api.setWindowAppearance(next)).catch((error) => {
      windowMode = undefined;
      console.warn("无法同步原生窗口外观", error);
    });
  }
}
function cache() {
  try {
    localStorage.setItem(storageKey, mode.value);
    localStorage.setItem(accentStorageKey, accent.value);
  } catch { /* Desktop preferences remain available when browser storage is blocked. */ }
}
function save(key: string, value: string) {
  if (!api.desktopAvailable) return Promise.resolve();
  // A failed write must not stop later choices from reaching the desktop store.
  const saved = saveQueue.then(() => api.setPreference(key, value));
  saveQueue = saved.catch(() => {});
  return saved;
}

// Restore before mounting. Startup replies may update each preference only if
// the user has not changed that preference since the request began.
export function initializeAppearance() {
  try {
    const cached = localStorage.getItem(storageKey);
    const cachedAccent = localStorage.getItem(accentStorageKey);
    if (valid(cached)) mode.value = cached;
    if (isAccentColor(cachedAccent)) accent.value = cachedAccent;
  } catch { /* Use defaults when local storage is unavailable. */ }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  systemDark.value = media.matches;
  const changed = () => { systemDark.value = media.matches; apply(); };
  media.addEventListener("change", changed);
  apply();
  return () => media.removeEventListener("change", changed);
}
export const appearanceRevision = () => ({ mode: modeRevision, accent: accentRevision });
export function restoreAppearance(preferences: Record<string, unknown>, startedAt: ReturnType<typeof appearanceRevision>) {
  if (modeRevision === startedAt.mode && valid(preferences["appearance.mode"])) mode.value = preferences["appearance.mode"];
  if (accentRevision === startedAt.accent && isAccentColor(preferences["appearance.accent"])) accent.value = preferences["appearance.accent"];
  cache();
  apply();
}
export async function setAppearance(value: AppearanceMode) {
  if (!valid(value)) return;
  modeRevision++;
  mode.value = value;
  cache();
  apply();
  await save("appearance.mode", value);
}
export async function setAccentColor(value: AccentColor) {
  if (!isAccentColor(value)) return;
  accentRevision++;
  accent.value = value;
  cache();
  apply();
  await save("appearance.accent", value);
}
