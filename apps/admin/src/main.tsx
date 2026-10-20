import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConfigError } from './ConfigError';
import { readEnv } from './env';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const env = readEnv();
createRoot(root).render(
  <StrictMode>{env.ok ? <App /> : <ConfigError problems={env.problems} />}</StrictMode>,
);
