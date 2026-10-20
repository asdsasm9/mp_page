import { createContext, useContext, type ReactNode } from 'react';
import type { Ports } from './ports';

const PortsContext = createContext<Ports | null>(null);

export function PortsProvider({ ports, children }: { ports: Ports; children: ReactNode }) {
  return <PortsContext.Provider value={ports}>{children}</PortsContext.Provider>;
}

export function usePorts(): Ports {
  const ports = useContext(PortsContext);
  if (!ports) throw new Error('usePorts outside PortsProvider');
  return ports;
}

const SiteUrlContext = createContext('');

/** Origin of the public site (VITE_PUBLIC_SITE_URL) for the "Zobrazit web" link; empty text links to "/". */
export function SiteUrlProvider({ url, children }: { url: string; children: ReactNode }) {
  return <SiteUrlContext.Provider value={url}>{children}</SiteUrlContext.Provider>;
}

export function useSiteUrl(): string {
  return useContext(SiteUrlContext);
}

const ImageBaseContext = createContext('');

/** Origin of the public image host (VITE_IMG_BASE_URL, no trailing slash); empty text gives relative URLs. */
export function ImageBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <ImageBaseContext.Provider value={base}>{children}</ImageBaseContext.Provider>;
}

export function useImageBase(): string {
  return useContext(ImageBaseContext);
}
