import { Gallery, pati, anez } from "./Data";
export type Review = {
  gallery: Gallery;
  description: string;
};

export const PatiReview: Review = {
  gallery: pati,
  description:
    "Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná. Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná. Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná",
};

export const AnezReview: Review = {
  gallery: anez,
  description:
    "S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!",
};
