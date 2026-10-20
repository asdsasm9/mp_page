import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../auth/session';
import { cs, glossary } from '../i18n/cs';
import { PublishLink } from './PublishLink';
import { StatusBanners } from './StatusBanners';
import { StorageBar } from './StorageBar';

export const MAIN_ID = 'obsah';

function SkipLink() {
  return (
    <a className="skip-link" href={`#${MAIN_ID}`}>
      {cs.skipLink}
    </a>
  );
}

/** Moves focus to the main region after an in-app navigation (not on first load, so Tab starts at the skip link). */
function useFocusMainOnNavigation() {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef<string | null>(null);
  const { pathname, state } = useLocation();
  // A screen that keeps focus on its own control (photo detail Předchozí / Další) navigates with this state.
  const keepFocus = (state as { keepFocus?: boolean } | null)?.keepFocus === true;
  useEffect(() => {
    if (previous.current !== null && previous.current !== pathname && !keepFocus) ref.current?.focus();
    previous.current = pathname;
  }, [pathname, keepFocus]);
  return ref;
}

const linkClass = 'nav-link';

/** Logged-out layout: skip link and one centred main region (login). */
export function AuthLayout() {
  const mainRef = useFocusMainOnNavigation();
  return (
    <>
      <SkipLink />
      <main id={MAIN_ID} ref={mainRef} tabIndex={-1} className="auth-main">
        <Outlet />
      </main>
    </>
  );
}

/** Shell of every screen after login: top bar, main region, phone bottom navigation. */
export function ShellLayout() {
  const mainRef = useFocusMainOnNavigation();
  const { signOut } = useSession();
  return (
    <div className="shell">
      <SkipLink />
      <header className="shell-header">
        <Link to="/" className="brand">
          {cs.app.name}
        </Link>
        <nav className="desktop-nav" aria-label={cs.nav.main}>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={linkClass}>
                {cs.nav.categories}
              </NavLink>
            </li>
            <li>
              <NavLink to="/nahravani" className={linkClass}>
                {cs.nav.upload}
              </NavLink>
            </li>
            <li>
              <NavLink to="/ulozeni" className={linkClass}>
                {cs.nav.storage}
              </NavLink>
            </li>
            <li>
              <PublishLink label={cs.nav.publishSite} className={linkClass} />
            </li>
          </ul>
        </nav>
        <StorageBar variant="mini" />
        <button type="button" className="button" onClick={() => void signOut()}>
          {glossary.logOut}
        </button>
      </header>
      <StatusBanners />
      <main id={MAIN_ID} ref={mainRef} tabIndex={-1} className="shell-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={cs.nav.bottom}>
        <ul className="nav-list">
          <li>
            <NavLink to="/" end className={linkClass}>
              {cs.nav.categories}
            </NavLink>
          </li>
          <li>
            <NavLink to="/nahravani" className={linkClass}>
              {cs.nav.upload}
            </NavLink>
          </li>
          <li>
            <PublishLink label={cs.nav.publish} className={linkClass} />
          </li>
        </ul>
      </nav>
    </div>
  );
}
