import { Gallery, paty, roman_anicka } from "./Data";
export type Review = {
  gallery: Gallery;
  description: string;
};

export const PatiReview: Review = {
  gallery: paty,
  description:
    "S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!",
};

export const AnickaReview: Review = {
  gallery: roman_anicka,
  description:
    "Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná. Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná. Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná",
};
