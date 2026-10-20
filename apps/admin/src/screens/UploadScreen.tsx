/** Upload queue page (`/nahravani`, ADMIN-UX 3.5): the same queue as the drawer, full width. */
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../components/Page';
import { UploadQueueView } from '../components/UploadQueueView';
import { cs } from '../i18n/cs';
import { useUploadState } from '../upload/UploadProvider';

export function UploadScreen() {
  useDocumentTitle(cs.routes.upload.title);
  const { queue, rejections } = useUploadState();
  const empty = queue.items.length === 0 && rejections.length === 0;
  return (
    <div className="page">
      <h1>{cs.routes.upload.title}</h1>
      {empty ? (
        <>
          <p className="page-note">{cs.upload.empty}</p>
          <p>
            <Link to="/">{cs.upload.emptyBack}</Link>
          </p>
        </>
      ) : (
        <UploadQueueView />
      )}
    </div>
  );
}
