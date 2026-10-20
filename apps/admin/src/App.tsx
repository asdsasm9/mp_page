import { Link, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AuthLayout, ShellLayout } from './components/Layouts';
import { Placeholder, useDocumentTitle } from './components/Page';
import { cs } from './i18n/cs';
import { AlbumScreen } from './screens/AlbumScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { CategoryScreen } from './screens/CategoryScreen';
import { PhotoDetailScreen } from './screens/PhotoDetailScreen';
import { PublishScreen } from './screens/PublishScreen';
import { UploadScreen } from './screens/UploadScreen';

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
          <Route path="/" element={<CategoriesScreen />} />
          <Route path="/kategorie/:id" element={<CategoryScreen />} />
          <Route path="/alba/:id" element={<AlbumScreen />} />
          <Route path="/alba/:id/foto/:photoId" element={<PhotoDetailScreen />} />
          <Route path="/zverejnit" element={<PublishScreen />} />
          <Route path="/ulozeni" element={<Placeholder title={cs.routes.storage.title} storageBar />} />
          <Route path="/nahravani" element={<UploadScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
