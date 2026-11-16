/** Instagram planning grid screen (`/instagram`, WP-14): legend, grid of posts, empty state with three steps. */
import { Link } from 'react-router-dom';
import { LoadFailure } from '../components/LoadFailure';
import { Notice } from '../components/Notice';
import { useDocumentTitle } from '../components/Page';
import { PageLoading } from '../components/PageLoading';
import { PlannerGrid } from '../components/PlannerGrid';
import { useIgPosts } from '../data/planner';
import { cs } from '../i18n/cs';
import { useImageBase } from '../ports-context';

export function InstagramScreen() {
  useDocumentTitle(cs.routes.instagram.title);
  const posts = useIgPosts();
  const imgBase = useImageBase();
  const rows = posts.data ?? [];
  const broken = rows.some((p) => p.status !== 'posted' && p.photos.length === 0);

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
        <ul className="ig-legend" aria-label={cs.instagram.legendLabel}>
          <li>
            <span className="ig-swatch ig-swatch-open" aria-hidden="true" />
            {cs.instagram.planned}
          </li>
          <li>
            <span className="ig-swatch" aria-hidden="true" />
            {cs.instagram.posted}
          </li>
          <li className="ig-legend-note">{cs.instagram.legendDashed}</li>
        </ul>
        <PlannerGrid posts={rows} imgBase={imgBase} />
      </>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{cs.routes.instagram.title}</h1>
        {rows.length > 0 ? (
          <Link to="/instagram/novy" className="button button-primary">
            {cs.instagram.newPost}
          </Link>
        ) : null}
      </div>
      {body}
    </div>
  );
}
