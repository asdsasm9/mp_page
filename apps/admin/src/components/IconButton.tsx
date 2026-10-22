/**
 * Icon-only action button (T-244). Inline SVG icons, no icon library and no icon font (docs/ADMIN.md).
 * The accessible name is the Czech `label` (aria-label plus the title tooltip); the SVG itself is hidden from
 * assistive technology. The 44 px touch target comes from `.button` (--target-min).
 */
import type { ReactNode } from 'react';

export type IconName = 'edit' | 'hide' | 'show' | 'publish' | 'move' | 'trash';

/** 24 x 24 paths, drawn as strokes in currentColor (the stylesheet sets size and stroke width). */
const PATHS: Record<IconName, ReactNode> = {
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  hide: (
    <>
      <path d="M17.9 17.9A10.6 10.6 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9" />
      <path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2" />
      <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" />
      <path d="m1 1 22 22" />
    </>
  ),
  show: (
    <>
      <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  publish: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  move: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M9 13h6" />
      <path d="m13 10 3 3-3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </>
  ),
};

/** Decorative icon (the button or the text beside it carries the name). */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

interface Props {
  icon: IconName;
  /** Czech accessible name; also the tooltip. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Destructive action: demoted to a quiet danger-coloured icon, the confirm dialog still follows. */
  danger?: boolean;
}

export function IconButton({ icon, label, onClick, disabled, danger }: Props) {
  return (
    <button
      type="button"
      className={danger ? 'button button-icon button-icon-danger' : 'button button-icon'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
