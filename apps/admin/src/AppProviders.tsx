import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ExpiredDialog } from './auth/ExpiredDialog';
import { SessionProvider } from './auth/session';
import { createHealthStore, HealthProvider } from './data/health';
import { createQueryClient } from './data/queryClient';
import type { Ports } from './ports';
import { PortsProvider } from './ports-context';

interface Props {
  ports: Ports;
  /** Tests switch query retries off. */
  retry?: boolean;
  children: ReactNode;
}

/** Ports, connectivity state, the query client and the session, with the expiry modal above the app. Router goes outside. */
export function AppProviders({ ports, retry, children }: Props) {
  const [health] = useState(createHealthStore);
  const [queryClient] = useState(() => createQueryClient(health, retry === undefined ? {} : { retry }));
  return (
    <PortsProvider ports={ports}>
      <HealthProvider store={health}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            {children}
            <ExpiredDialog />
          </SessionProvider>
        </QueryClientProvider>
      </HealthProvider>
    </PortsProvider>
  );
}
