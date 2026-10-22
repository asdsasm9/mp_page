import { useState } from 'react';

/** Edge length in CSS pixels; the stylesheet sizes it with --cover-size (6rem). */
export const COVER_PX = 96;

/**
 * Cover thumbnail of an album row: the 480 px WebP at 96 px, decorative (the title beside it names the album).
 * Without a cover, or when the image fails to load, a neutral placeholder of the same size is shown.
 */
export function CoverThumb({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src === null || failedSrc === src) {
    return <span className="cover cover-placeholder" aria-hidden="true" />;
  }
  return (
    <img
      className="cover"
      src={src}
      width={COVER_PX}
      height={COVER_PX}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
}
