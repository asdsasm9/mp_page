import type { ReactNode } from 'react';

interface Props {
  /** error: red notice, role="alert". info: plain notice, role="status". */
  variant?: 'error' | 'info';
  /** The element to render; a notice with block children (paragraphs, buttons) needs a div. */
  as?: 'p' | 'div';
  children: ReactNode;
}

/** A notice box: `.notice` (+ `.notice-error`) with the live-region role that goes with its variant. */
export function Notice({ variant = 'error', as: Tag = 'p', children }: Props) {
  return variant === 'error' ? (
    <Tag className="notice notice-error" role="alert">
      {children}
    </Tag>
  ) : (
    <Tag className="notice" role="status">
      {children}
    </Tag>
  );
}
