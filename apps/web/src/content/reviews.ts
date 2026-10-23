/** Client reviews shown on the home page. Source: legacy-cra `src/data/DataTexts.ts`. */

export type Review = {
  /** Legacy album id the review belongs to (its cover is shown next to the text). */
  readonly albumId: string;
  /** Display name, as the legacy album name. Q-16: client consent for names. */
  readonly name: string;
  /** The client's full words, untouched (shown under "Celá recenze"). */
  readonly text: string;
  /** Carousel text: whole contiguous leading sentences of `text`, 150 to 220 characters, never reworded. */
  readonly short: string;
};

export const REVIEWS: readonly Review[] = [
  {
    albumId: 'pati',
    name: 'Pati',
    text: 'Focení s Terkou byla skvělá zkušenost! Byla velmi příjemná, ochotná a přizpůsobila se mému tempu a stylu. Všechny fotografie jsou naprosto nádherné, s dokonalým světlem a krásnými barvami. Terka dokázala zachytit krásné momenty a emoce, a to mě naprosto nadchlo. Navíc, byla velmi rychlá v dodání hotových fotografií. Můžu s klidem říct, že je jedna z nejlepších fotografů, se kterými jsem měla tu čest spolupracovat.',
    short:
      'Focení s Terkou byla skvělá zkušenost! Byla velmi příjemná, ochotná a přizpůsobila se mému tempu a stylu. Všechny fotografie jsou naprosto nádherné, s dokonalým světlem a krásnými barvami.',
  },
  {
    albumId: 'anez',
    name: 'Anež',
    text: 'Spolupráce s Terkou byla úžasná. Od začátku do konce byli velmi profesionální, kreativní a velmi rychlá v odpovědích. Fotografie jsou úžasné, s krásnými barvami a úžasnými detaily. Terka mi pomohla uvolnit se před kamerou a výsledné fotografie jsou prostě fantastické. Určitě doporučuji pro vaši další focení',
    short:
      'Spolupráce s Terkou byla úžasná. Od začátku do konce byli velmi profesionální, kreativní a velmi rychlá v odpovědích. Fotografie jsou úžasné, s krásnými barvami a úžasnými detaily.',
  },
];
