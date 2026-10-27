// Arco provides the popup layer and Escape handling. Keep keyboard focus inside
// the topmost application dialog, including nested recovery confirmations.
const dialogs: HTMLElement[] = [];
let wasInert = false;
export function containModalFocus(dialog: HTMLElement) {
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const root = document.getElementById("root");
  if (!dialogs.length && root) {
    wasInert = root.inert;
    root.inert = true;
  }
  dialogs.push(dialog);
  const focusable = () =>
    [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
      ),
    ].filter((e) => e.getClientRects().length > 0);
  const initial = () => {
    if (dialog.contains(document.activeElement)) return;
    const target =
      dialog.querySelector<HTMLElement>(
        "[autofocus],input:not([disabled]),select:not([disabled])",
      ) || focusable()[0];
    target?.focus();
  };
  initial();
  const keydown = (e: KeyboardEvent) => {
    if (dialogs[dialogs.length - 1] !== dialog || e.key !== "Tab") return;
    const items = focusable(),
      first = items[0],
      last = items[items.length - 1];
    if (!first) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        !dialog.contains(document.activeElement))
    ) {
      e.preventDefault();
      last?.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last ||
        !dialog.contains(document.activeElement))
    ) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", keydown, true);
  return () => {
    document.removeEventListener("keydown", keydown, true);
    const index = dialogs.indexOf(dialog);
    if (index >= 0) dialogs.splice(index, 1);
    if (!dialogs.length && root) root.inert = wasInert;
    requestAnimationFrame(() => {
      if (previous?.isConnected && !previous.closest("[inert]"))
        previous.focus();
    });
  };
}
