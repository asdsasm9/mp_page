/** Quality block of the photo detail (WP-10, T-260): badges, master pixel size, master and overview file sizes, tier list. */
import { DETAIL_MIN_LONG_EDGE, type PhotoRow } from '@mp/shared';
import { photoQuality } from '../data/photoQuality';
import { cs } from '../i18n/cs';
import { fill, formatBytes } from '../i18n/format';
import { QualityBadges } from './QualityBadge';

export function PhotoQualityFacts({ photo }: { photo: Pick<PhotoRow, 'width' | 'height' | 'variants'> }) {
  const q = photoQuality(photo);
  const tierList = q.tiers.map((t) => (/^\d+$/.test(t) ? `${t} ${cs.quality.tiersUnit}` : t)).join(', ');
  return (
    <section className="quality-facts" aria-labelledby="quality-heading">
      <h2 id="quality-heading">{cs.quality.heading}</h2>
      <p className="quality-badges">
        <QualityBadges quality={q} />
      </p>
      {q.low ? <p className="field-hint">{fill(cs.quality.lowHint, { min: DETAIL_MIN_LONG_EDGE })}</p> : null}
      {q.missing.length > 0 ? <p className="field-hint">{fill(cs.quality.missingList, { list: q.missing.join(', ') })}</p> : null}
      <dl className="quality-list">
        <div>
          <dt>{cs.quality.masterSize}</dt>
          <dd>{fill(cs.quality.pixels, { w: q.width, h: q.height })}</dd>
        </div>
        <div>
          <dt>{cs.quality.masterBytes}</dt>
          <dd>{formatBytes(q.masterBytes)}</dd>
        </div>
        <div>
          <dt>{cs.quality.overviewBytes}</dt>
          <dd>{formatBytes(q.overviewBytes)}</dd>
        </div>
        <div>
          <dt>{cs.quality.tiers}</dt>
          <dd>{tierList}</dd>
        </div>
      </dl>
    </section>
  );
}
