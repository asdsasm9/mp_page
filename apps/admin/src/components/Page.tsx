import { useEffect } from 'react';
import { cs } from '../i18n/cs';

/** Sets the document title ("Fotka – Mullny Photos – správa") while the page is shown. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title}${cs.app.titleSeparator}${cs.app.name}`;
  }, [title]);
}

/** Placeholder body of a route: the one h1 and a short note. Real screens replace it (WP5-05 onwards). */
export function Placeholder({ title }: { title: string }) {
  useDocumentTitle(title);
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="page-note">{cs.placeholder.body}</p>
    </div>
  );
}
