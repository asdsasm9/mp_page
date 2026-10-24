/**
 * `/llms.txt` builder (docs/SEO-AI.md). A short, factual Markdown summary for AI assistants, generated at build
 * from the catalog. Only facts already published on the site: no prices, no phone, no invented claims.
 */
import type { SnapshotCategory } from '@mp/shared';
import { INSTAGRAM_HANDLE, MAIL_ADDRESS, MYWED_URL } from '../content/texts';
import { BUSINESS_DESCRIPTION, pageUrl } from './jsonld';
import { BRAND } from './seo';

export function buildLlmsTxt(categories: readonly SnapshotCategory[]): string {
  const lines = [
    `# ${BRAND}`,
    '',
    `> ${BUSINESS_DESCRIPTION}`,
    '',
    'Terezie Müllnerová (Terka) fotí svatby, portréty (včetně rodinných a těhotenských) a páry. Sídlí v Brně, fotí v Brně a Jihomoravském kraji. Web je česky.',
    '',
    '## Stránky',
    '',
    `- [Úvod](${pageUrl('/')}): kdo je fotografka a výběr kategorií`,
    `- [Portfolio](${pageUrl('/portfolio/')}): všechny kategorie a výběr alb`,
    ...categories.map((c) => `- [${c.name}](${pageUrl(`/${c.slug}/`)}): ${c.albums.length} alb`),
    '',
    `Na úvodní stránce jsou i sekce [O mně](${pageUrl('/')}#o-mne) (příběh a zkušenosti) a [Kontakt](${pageUrl('/')}#kontakt) (jak objednat focení).`,
    '',
    '## Kontakt',
    '',
    `- E-mail: ${MAIL_ADDRESS}`,
    `- Instagram: ${INSTAGRAM_HANDLE} (https://www.instagram.com/${INSTAGRAM_HANDLE.replace(/^@/, '')}/)`,
    `- MyWed: ${MYWED_URL}`,
    '',
    '## Poznámka',
    '',
    'Ceny na webu nejsou uvedeny; o termínu a podmínkách je třeba napsat e-mailem nebo přes Instagram.',
    '',
  ];
  return lines.join('\n');
}
