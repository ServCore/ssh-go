import type { ITheme } from "@xterm/xterm";

export const terminalAnsi = {
  dark: {
    black: "#515e73",
    red: "#ff7a90",
    green: "#6cdea0",
    yellow: "#f2ce75",
    blue: "#81aaff",
    magenta: "#c79bff",
    cyan: "#6bd8e4",
    white: "#dce5f5",
    brightBlack: "#8795ac",
    brightRed: "#ff9bad",
    brightGreen: "#93efb7",
    brightYellow: "#ffe29a",
    brightBlue: "#a6c4ff",
    brightMagenta: "#ddbbff",
    brightCyan: "#96eaf2",
    brightWhite: "#f5f8ff",
  },
  light: {
    black: "#243247",
    red: "#b42338",
    green: "#13734b",
    yellow: "#8a5c00",
    blue: "#235cc8",
    magenta: "#8b3fb3",
    cyan: "#006c7b",
    white: "#647187",
    brightBlack: "#626c7e",
    brightRed: "#bc344f",
    brightGreen: "#16794d",
    brightYellow: "#8f6500",
    brightBlue: "#3268d4",
    brightMagenta: "#914abc",
    brightCyan: "#007789",
    brightWhite: "#243247",
  },
};
export function terminalTheme(dark: boolean): ITheme {
  const style = getComputedStyle(document.documentElement);
  return {
    ...terminalAnsi[dark ? "dark" : "light"],
    background: style.getPropertyValue("--terminal-bg").trim(),
    foreground: style.getPropertyValue("--terminal-text").trim(),
    cursor: style.getPropertyValue("--terminal-cursor").trim(),
    cursorAccent: style.getPropertyValue("--terminal-bg").trim(),
    selectionForeground: style.getPropertyValue("--terminal-text").trim(),
    selectionBackground: style.getPropertyValue("--terminal-selection").trim(),
    selectionInactiveBackground: style
      .getPropertyValue("--terminal-selection-inactive")
      .trim(),
  };
}

// A single line, filled into the existing shell without submitting Enter.
// Back up only once so applying twice still restores the user's original prompt.
export const colorPromptCommand =
  "if [ -n \"${BASH_VERSION-}\" ]; then [ \"${SSH_TOOLS_ORIGINAL_PS1+x}\" = x ] || SSH_TOOLS_ORIGINAL_PS1=$PS1; if [ \"${EUID-}\" = 0 ]; then PS1='\\[\\e[1;31m\\]\\u\\[\\e[0m\\]@\\[\\e[36m\\]\\h\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ '; else PS1='\\[\\e[1;32m\\]\\u\\[\\e[0m\\]@\\[\\e[36m\\]\\h\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ '; fi; elif [ -n \"${ZSH_VERSION-}\" ]; then [ \"${SSH_TOOLS_ORIGINAL_PROMPT+x}\" = x ] || SSH_TOOLS_ORIGINAL_PROMPT=$PROMPT; PROMPT='%(#.%F{red}.%F{green})%n%f@%F{cyan}%m%f:%F{blue}%~%f%# '; else printf '%s\\n' '此命令支持 Bash / Zsh'; fi";
export const restorePromptCommand =
  'if [ -n "${BASH_VERSION-}" ] && [ "${SSH_TOOLS_ORIGINAL_PS1+x}" = x ]; then PS1=$SSH_TOOLS_ORIGINAL_PS1; unset SSH_TOOLS_ORIGINAL_PS1; elif [ -n "${ZSH_VERSION-}" ] && [ "${SSH_TOOLS_ORIGINAL_PROMPT+x}" = x ]; then PROMPT=$SSH_TOOLS_ORIGINAL_PROMPT; unset SSH_TOOLS_ORIGINAL_PROMPT; else printf \'%s\\n\' \'当前会话没有已保存的原提示符\'; fi';
