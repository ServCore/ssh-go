export const accentOptions = [
  { value: "blue", label: "蓝色", light: "#3370ff", dark: "#8bb5ff", fill: "#3268df" },
  { value: "green", label: "绿色", light: "#20845d", dark: "#76cfa4", fill: "#20845d" },
  { value: "red", label: "红色", light: "#c5424d", dark: "#f29ca4", fill: "#c5424d" },
  { value: "orange", label: "橙色", light: "#a75a22", dark: "#e9b386", fill: "#a75a22" },
  { value: "purple", label: "紫色", light: "#7a5cc3", dark: "#bea7ec", fill: "#7552d6" },
] as const;
export type AccentColor = typeof accentOptions[number]["value"];
export function isAccentColor(value: unknown): value is AccentColor {
  return accentOptions.some(option => option.value === value);
}
function channels(hex: string) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}
function mix(a: string, b: string, weight: number) {
  const first = channels(a), second = channels(b);
  return "#" + first.map((value, i) => Math.round(value * (1 - weight) + second[i]! * weight).toString(16).padStart(2, "0")).join("");
}
export function applyAccent(color: AccentColor, dark: boolean) {
  const palette = accentOptions.find(option => option.value === color)!;
  const main = palette[dark ? "dark" : "light"];
  // Blend against the actual theme surface so accents never retain an old tint.
  const base = dark ? getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#292831" : "#ffffff";
  const style = document.documentElement.style;
  document.documentElement.dataset.accent = color;
  const fill = palette.fill;
  const hover = mix(fill, "#000000", .1);
  const pressed = mix(fill, "#000000", .2);
  style.setProperty("--action-fill", fill);
  style.setProperty("--action-hover", hover);
  style.setProperty("--action-pressed", pressed);
  style.setProperty("--accent", main);
  style.setProperty("--accent-solid", palette.light);
  style.setProperty("--accent-soft", mix(base, main, dark ? .15 : .09));
  style.setProperty("--accent-line", mix(base, main, dark ? .35 : .25));
  style.setProperty("--focus-ring", `rgba(${channels(main).join(", ")}, ${dark ? .24 : .16})`);
  style.setProperty("--on-accent", "#ffffff");
  style.setProperty("--terminal-cursor", main);
  style.setProperty("--terminal-selection", `rgba(${channels(main).join(", ")}, ${dark ? .28 : .2})`);
  style.setProperty("--terminal-selection-inactive", `rgba(${channels(main).join(", ")}, .12)`);
  // Filled controls use a saturated color with white text; links/icons keep
  // their independently readable foreground. Arco consumes RGB channel lists.
  const steps = [
    ...[.06, .12, .24, .4].map(weight => mix(base, main, weight)), hover, fill,
    pressed, ...[.35, .5, .65].map(weight => mix(fill, "#000000", weight)),
  ];
  steps.forEach((step, i) => style.setProperty(`--accent-primary-${i + 1}`, channels(step).join(", ")));
}
