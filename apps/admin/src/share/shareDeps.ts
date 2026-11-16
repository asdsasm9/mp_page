/**
 * The browser calls behind "posting by hand" (WP-14, T-346), as one seam: tests inject fakes through
 * `ShareDepsProvider` (ports-context), the app uses `realShareDeps`. Nothing here touches the network on import.
 */
export interface ShareDeps {
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** navigator.share; rejects with AbortError when the person cancels the sheet. */
  share(data: ShareData): Promise<void>;
  /** navigator.canShare; false when the browser has no file sharing. */
  canShare(data: ShareData): boolean;
  writeText(text: string): Promise<void>;
  /** Saves one file through a blob URL and `<a download>`. */
  download(file: File): void;
}

export const realShareDeps: ShareDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
  share: (data) => globalThis.navigator.share(data),
  canShare: (data) => {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    try {
      return nav.canShare(data);
    } catch {
      return false;
    }
  },
  writeText: (text) => {
    const clipboard = globalThis.navigator?.clipboard;
    return clipboard ? clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
  },
  download: (file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
