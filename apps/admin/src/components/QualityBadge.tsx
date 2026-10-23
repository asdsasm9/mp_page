/**
 * Verdict badge of a stored photo (WP-10, T-260): "Nízké rozlišení", "Dobré", "Chybí varianta". Shared with the storage
 * screen (T-263). Never colour alone: every verdict has its own icon, its own border style and its text.
 */
import type { PhotoVerdict } from '@mp/shared';
import { badgeVerdicts, type PhotoQuality } from '../data/photoQuality';
import { cs } from '../i18n/cs';

const ICONS: Record<PhotoVerdict, string> = {
  low: 'M8 2 L15 14 H1 Z M8 6.5 V10 M8 12 V12.2',
  good: 'M2.5 8.5 L6.5 12 L13.5 4',
  missing: 'M8 2 A6 6 0 1 0 8.01 2 M8 5 V8.5 M8 11 V11.2',
};

export function QualityBadge({ verdict, className }: { verdict: PhotoVerdict; className?: string }) {
  return (
    <span className={className ? `quality-badge ${className}` : 'quality-badge'} data-verdict={verdict}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path d={ICONS[verdict]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {cs.quality.verdict[verdict]}
    </span>
  );
}

/** All badges of one photo (low resolution and missing variant can both apply). */
export function QualityBadges({
  quality,
  hideGood = false,
  className,
}: {
  quality: Pick<PhotoQuality, 'low' | 'verdict'>;
  /** Grid tiles stay quiet for photos without a problem. */
  hideGood?: boolean;
  className?: string;
}) {
  const verdicts = badgeVerdicts(quality).filter((v) => !(hideGood && v === 'good'));
  return (
    <>
      {verdicts.map((v) => (
        <QualityBadge key={v} verdict={v} className={className} />
      ))}
    </>
  );
}
