import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ExpiredDialog } from './auth/ExpiredDialog';
import { SessionProvider } from './auth/session';
import { ToastProvider } from './components/Toast';
import { createHealthStore, HealthProvider } from './data/health';
import { createQueryClient } from './data/queryClient';
import type { Ports } from './ports';
import { ImageBaseProvider, PortsProvider } from './ports-context';

interface Props {
  ports: Ports;
  /** Tests switch query retries off. */
  retry?: boolean;
  /** Public image host for thumbnails (VITE_IMG_BASE_URL). */
  imgBaseUrl?: string;
  children: ReactNode;
}

/** Ports, connectivity state, the query client and the session, with the expiry modal above the app. Router goes outside. */
export function AppProviders({ ports, retry, imgBaseUrl = '', children }: Props) {
  const [health] = useState(createHealthStore);
  const [queryClient] = useState(() => createQueryClient(health, retry === undefined ? {} : { retry }));
  return (
    <PortsProvider ports={ports}>
      <ImageBaseProvider base={imgBaseUrl}>
        <HealthProvider store={health}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <ToastProvider>{children}</ToastProvider>
              <ExpiredDialog />
            </SessionProvider>
          </QueryClientProvider>
        </HealthProvider>
      </ImageBaseProvider>
    </PortsProvider>
  );
}
