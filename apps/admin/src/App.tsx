import { Link, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AuthLayout, ShellLayout } from './components/Layouts';
import { Placeholder, useDocumentTitle } from './components/Page';
import { cs } from './i18n/cs';

function NotFound() {
  useDocumentTitle(cs.notFound.title);
  return (
    <div className="page">
      <h1>{cs.notFound.title}</h1>
      <p className="page-note">{cs.notFound.body}</p>
      <p>
        <Link to="/">{cs.notFound.back}</Link>
      </p>
    </div>
  );
}

/** Route table. Screens are placeholders until their work packages (WP5-05 onwards). Needs a Router above. */
export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/prihlaseni" element={<LoginPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<Placeholder title={cs.routes.categories.title} />} />
          <Route path="/kategorie/:id" element={<Placeholder title={cs.routes.category.title} />} />
          <Route path="/alba/:id" element={<Placeholder title={cs.routes.album.title} />} />
          <Route path="/alba/:id/foto/:photoId" element={<Placeholder title={cs.routes.photo.title} />} />
          <Route path="/zverejnit" element={<Placeholder title={cs.routes.publish.title} />} />
          <Route path="/ulozeni" element={<Placeholder title={cs.routes.storage.title} />} />
          <Route path="/nahravani" element={<Placeholder title={cs.routes.upload.title} />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
