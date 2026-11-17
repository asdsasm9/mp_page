import { createContext, useContext, type ReactNode } from 'react';
import { cropAvatarFile, type CropAvatar } from './encode/cropSquare';
import type { Ports } from './ports';
import { realShareDeps, type ShareDeps } from './share/shareDeps';

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

const ShareDepsContext = createContext<ShareDeps>(realShareDeps);

/** Browser calls for sharing a post by hand (T-346); tests inject fakes, the app uses the real ones. */
export function ShareDepsProvider({ deps, children }: { deps: ShareDeps; children: ReactNode }) {
  return <ShareDepsContext.Provider value={deps}>{children}</ShareDepsContext.Provider>;
}

export function useShareDeps(): ShareDeps {
  return useContext(ShareDepsContext);
}

const AvatarCropContext = createContext<CropAvatar>(cropAvatarFile);

/** Crops a picked file to the 480 px square WebP of the Instagram avatar; tests inject a stub (jsdom has no canvas). */
export function AvatarCropProvider({ crop, children }: { crop: CropAvatar; children: ReactNode }) {
  return <AvatarCropContext.Provider value={crop}>{children}</AvatarCropContext.Provider>;
}

export function useAvatarCrop(): CropAvatar {
  return useContext(AvatarCropContext);
}

const ImageBaseContext =createContext('');

/** Origin of the public image host (VITE_IMG_BASE_URL, no trailing slash); empty text gives relative URLs. */
export function ImageBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <ImageBaseContext.Provider value={base}>{children}</ImageBaseContext.Provider>;
}

export function useImageBase(): string {
  return useContext(ImageBaseContext);
}
