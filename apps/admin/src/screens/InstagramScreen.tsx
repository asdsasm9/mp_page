/**
 * Instagram profile preview (`/instagram`, WP-14 and WP-15): the filter and the "Řadit příspěvky" toggle above a
 * profile frame (header with the typed profile, then the grid of posts), empty state with three steps. The profile is
 * loaded on its own: when that fails the preview shows the defaults and a notice, and the posts never wait for it.
 */
import { filterPosts, type IgFilter } from '@mp/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadFailure } from '../components/LoadFailure';
import { Notice } from '../components/Notice';
import { useDocumentTitle } from '../components/Page';
import { PageLoading } from '../components/PageLoading';
import { PlannerGrid } from '../components/PlannerGrid';
import { ProfileFilter, useIgFilter } from '../components/ProfileFilter';
import { ProfileHeader } from '../components/ProfileHeader';
import { useIgPosts, useIgProfile } from '../data/planner';
import { cs } from '../i18n/cs';
import { useImageBase } from '../ports-context';

const EMPTY_TEXT: Record<IgFilter, string | null> = {
  all: null,
  posted: cs.instagram.filter.emptyPosted,
  planned: cs.instagram.filter.emptyPlanned,
};

export function InstagramScreen() {
  useDocumentTitle(cs.routes.instagram.title);
  const posts = useIgPosts();
  const profile = useIgProfile();
  const imgBase = useImageBase();
  const [filter, setFilter] = useIgFilter();
  const [sortOn, setSortOn] = useState(false);
  const noteId = useId();
  const rows = posts.data ?? [];
  const broken = rows.some((p) => p.status !== 'posted' && p.photos.length === 0);
  const shown = filterPosts(rows, filter);
  const counts: Record<IgFilter, number> = {
    all: rows.length,
    posted: filterPosts(rows, 'posted').length,
    planned: filterPosts(rows, 'planned').length,
  };
  // Posted posts are ordered by date, so there is nothing to sort under "Zveřejněné".
  const sortDisabled = filter === 'posted';
  const sorting = sortOn && !sortDisabled;
  const emptyText = EMPTY_TEXT[filter];
  // Choosing "Zveřejněné" switches the sort mode off for good: coming back to "Vše" or "Naplánované" starts as a pure preview.
  const changeFilter = (next: IgFilter) => {
    if (next === 'posted') setSortOn(false);
    setFilter(next);
  };

  let body;
  if (posts.isError) {
    body = <LoadFailure error={posts.error} message={cs.instagram.loadFailed} onRetry={() => void posts.refetch()} />;
  } else if (!posts.data) {
    body = <PageLoading>{cs.data.loading}</PageLoading>;
  } else if (rows.length === 0) {
    body = (
      <div className="empty-state">
        <p>{cs.instagram.emptyTitle}</p>
        <ol className="ig-steps">
          {cs.instagram.emptySteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Link to="/instagram/novy" className="button button-primary">
          {cs.instagram.newPost}
        </Link>
      </div>
    );
  } else {
    body = (
      <>
        {broken ? <Notice variant="info">{cs.instagram.brokenNotice}</Notice> : null}
        {profile.isError ? <Notice variant="info">{cs.instagram.profile.loadFailed}</Notice> : null}
        <div className="ig-controls">
          <ProfileFilter value={filter} onChange={changeFilter} counts={counts} />
          <button
            type="button"
            className="button ig-sort-toggle"
            aria-pressed={sorting}
            aria-describedby={sortDisabled ? noteId : undefined}
            disabled={sortDisabled}
            onClick={() => setSortOn((on) => !on)}
          >
            {cs.instagram.sort.toggle}
          </button>
          <Link to="/instagram/novy" className="button button-primary ig-new">
            {cs.instagram.newPost}
          </Link>
          {sortDisabled ? (
            <p id={noteId} className="field-hint ig-sort-note">
              {cs.instagram.sort.postedNote}
            </p>
          ) : null}
        </div>
        <section className="ig-frame" aria-label={cs.instagram.profile.label}>
          {profile.isError || profile.data ? (
            <ProfileHeader profile={profile.data ?? null} postCount={shown.length} imgBase={imgBase} />
          ) : (
            <div className="ig-profile ig-profile-pending" aria-busy="true" />
          )}
          {emptyText && shown.length === 0 ? (
            <p className="ig-filter-empty">{emptyText}</p>
          ) : (
            <PlannerGrid posts={shown} imgBase={imgBase} sorting={sorting} />
          )}
        </section>
      </>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{cs.routes.instagram.title}</h1>
      </div>
      {body}
    </div>
  );
}
