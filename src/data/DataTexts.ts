import { Gallery, pati, anez } from "./Data";
export type Review = {
  gallery: Gallery;
  description: string;
};

export const PatiReview: Review = {
  gallery: pati,
  description:
    "Focení s Terkou byla skvělá zkušenost! Byla velmi příjemná, ochotná a přizpůsobila se mému tempu a stylu. \
    Všechny fotografie jsou naprosto nádherné, s dokonalým světlem a krásnými barvami. \
    Terka dokázala zachytit krásné momenty a emoce, a to mě naprosto nadchlo. Navíc, byla velmi rychlá v dodání hotových fotografií.\
    Můžu s klidem říct, že je jedna z nejlepších fotografů, se kterými jsem měla tu čest spolupracovat. ",
};

export const AnezReview: Review = {
  gallery: anez,
  description:
    "Spolupráce s Terkou byla úžasná. Od začátku do konce byli velmi profesionální, kreativní a velmi rychlá v odpovědích. Fotografie jsou úžasné, s krásnými barvami a úžasnými detaily. Terka mi pomohla uvolnit se před kamerou a výsledné fotografie jsou prostě fantastické. Určitě doporučuji pro vaši další focení",
};
