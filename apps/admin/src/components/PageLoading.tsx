import type { ReactNode } from 'react';

/** The "loading" line of a page or panel: a polite status that tells assistive tech the region is busy. */
export function PageLoading({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-busy="true" className="page-note">
      {children}
    </p>
  );
}
