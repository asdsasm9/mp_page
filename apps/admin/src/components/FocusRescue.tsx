import { useEffect } from 'react';

const ENABLED_FOCUSABLE =
  'button:not([disabled]):not([aria-disabled="true"]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const isDisabled = (el: Element): boolean => 'disabled' in el && (el as HTMLButtonElement).disabled === true;
const onBody = () => document.activeElement === null || document.activeElement === document.body;

/** Where lost focus goes: into the open dialog if there is one (the page behind it is inert), else the main region. */
function fallbackTarget(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('dialog[open]');
  const dialog = dialogs[dialogs.length - 1];
  if (dialog) return dialog.querySelector<HTMLElement>(`[data-autofocus], ${ENABLED_FOCUSABLE}`);
  return document.querySelector<HTMLElement>('main');
}

/**
 * Focus must never fall to the page body while the user is working with the keyboard. Two cases:
 * - the control that has focus becomes disabled (most busy controls use aria-disabled and keep focus; this is
 *   the net for the rest, e.g. controls disabled while offline): focus moves to the nearest enabled control
 *   around it, else to the fallback;
 * - the focused element is removed (a photo that was deleted, a row that moved away): focus goes to the fallback.
 * Mounted once, near the root.
 */
export function FocusRescue() {
  useEffect(() => {
    let last: Element | null = null;
    const onFocusIn = (event: FocusEvent) => {
      last = event.target instanceof Element ? event.target : null;
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const el = record.target;
          if (!(el instanceof HTMLElement) || !isDisabled(el)) continue;
          if (!(el === document.activeElement || (el === last && onBody()))) continue;
          let container = el.parentElement;
          while (container && container !== document.body) {
            if (container.matches('dialog')) break;
            const next = [...container.querySelectorAll<HTMLElement>(ENABLED_FOCUSABLE)].find((c) => c !== el);
            if (next) {
              next.focus();
              return;
            }
            container = container.parentElement;
          }
          fallbackTarget()?.focus();
          return;
        }
        if (last && !last.isConnected && onBody()) {
          last = null;
          fallbackTarget()?.focus();
          return;
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    document.addEventListener('focusin', onFocusIn);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);
  return null;
}
