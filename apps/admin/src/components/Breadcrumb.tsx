import { Link } from 'react-router-dom';
import { cs } from '../i18n/cs';

export interface Crumb {
  label: string;
  /** Missing on the last crumb (the current page). */
  to?: string;
}

/** Breadcrumb trail; the last item is the current page. */
export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav className="breadcrumb" aria-label={cs.categoryDetail.breadcrumbLabel}>
      <ol>
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`}>
            {item.to && index < items.length - 1 ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
