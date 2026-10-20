import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/app.css';
import { loadPorts } from './adapters/select';
import { App } from './App';
import { AppProviders } from './AppProviders';
import { ConfigError } from './ConfigError';
import { readEnv } from './env';
import { messageForCode } from './i18n/messages';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
const root = createRoot(container);
const show = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

const env = readEnv();
if (!env.ok) {
  show(<ConfigError problems={env.problems} />);
} else {
  loadPorts(env.env).then(
    (ports) =>
      show(
        <AppProviders ports={ports} imgBaseUrl={env.env.imgBaseUrl}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppProviders>,
      ),
    (error: unknown) => show(<ConfigError problems={[error instanceof Error ? error.message : messageForCode('UNKNOWN')]} />),
  );
}
