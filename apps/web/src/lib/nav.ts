export interface NavItem {
  readonly label: string;
  /** Path with leading and trailing slash, e.g. `/svatby/`. */
  readonly path: string;
}

/** `aria-current="page"` goes on the link whose path is exactly the current page. */
export const isCurrent = (current: string, path: string): boolean => current === path;

/** On a deeper page (an album) the category link is a section marker only, never `aria-current`. */
export const isSection = (current: string, path: string): boolean =>
  path !== '/' && current !== path && current.startsWith(path);

/** The `aria-current` value for a nav link. */
export const ariaCurrent = (current: string, path: string): 'page' | undefined =>
  isCurrent(current, path) ? 'page' : undefined;
