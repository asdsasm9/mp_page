import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadPorts } from './adapters/select';
import { App } from './App';
import { ConfigError } from './ConfigError';
import { readEnv } from './env';
import { PortsProvider } from './ports-context';

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
        <PortsProvider ports={ports}>
          <App />
        </PortsProvider>,
      ),
    (error: unknown) => show(<ConfigError problems={[error instanceof Error ? error.message : 'Neznámá chyba']} />),
  );
}
