import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ExpiredDialog } from './auth/ExpiredDialog';
import { SessionProvider } from './auth/session';
import { ToastProvider } from './components/Toast';
import { createHealthStore, HealthProvider } from './data/health';
import { createQueryClient } from './data/queryClient';
import type { Ports } from './ports';
import { ImageBaseProvider, PortsProvider, SiteUrlProvider } from './ports-context';
import type { Encoder } from './upload/types';
import { UploadProvider } from './upload/UploadProvider';

interface Props {
  ports: Ports;
  /** Tests switch query retries off. */
  retry?: boolean;
  /** Public image host for thumbnails (VITE_IMG_BASE_URL). */
  imgBaseUrl?: string;
  /** Public site origin for the "Zobrazit web" link (VITE_PUBLIC_SITE_URL). */
  siteUrl?: string;
  /** Tests inject a stub encoder; the app encodes with the canvas encoder. */
  encoder?: Encoder;
  children: ReactNode;
}

/** Ports, connectivity state, the query client and the session, with the expiry modal above the app. Router goes outside. */
export function AppProviders({ ports, retry, imgBaseUrl = '', siteUrl = '', encoder, children }: Props) {
  const [health] = useState(createHealthStore);
  const [queryClient] = useState(() => createQueryClient(health, retry === undefined ? {} : { retry }));
  return (
    <PortsProvider ports={ports}>
      <ImageBaseProvider base={imgBaseUrl}>
        <SiteUrlProvider url={siteUrl}>
          <HealthProvider store={health}>
            <QueryClientProvider client={queryClient}>
              <SessionProvider>
                <ToastProvider>
                  <UploadProvider {...(encoder ? { encoder } : {})}>{children}</UploadProvider>
                </ToastProvider>
                <ExpiredDialog />
              </SessionProvider>
            </QueryClientProvider>
          </HealthProvider>
        </SiteUrlProvider>
      </ImageBaseProvider>
    </PortsProvider>
  );
}
