/**
 * All page text of the public site (Czech). Source: branch `legacy-cra`, see docs/AUDIT.md section 4.
 * Copied verbatim, then only the typo fixes listed in docs/TEXTS-REVIEW.md were applied.
 */

export type TextBlock = {
  readonly title: string;
  readonly body: string;
};

export const KNOW_MORE = 'ZOBRAZIT VÍC';
export const INSTAGRAM_URL = 'https://www.instagram.com/mullny_photos/?hl=cs';
export const MAIL_ADDRESS = 'mullnyphotos@gmail.com';
/** No space after `mailto:` (the legacy constant had one). */
export const MAIL_URL = 'mailto:mullnyphotos@gmail.com';
export const INSTAGRAM_HANDLE = '@mullny_photos';
export const MYWED_URL = 'https://mywed.com/cs/photographer/mullny/';
export const MYWED_TITLE = 'Svatební fotograf Terezie Müllnerová (Brno, Česko) | MyWed';

export const SITE = {
  name: 'Mullny photos',
  /** Legacy meta description and manifest name, "portrétu" fixed to "portrétů". */
  description: 'Focení svateb, portrétů a párových fotek',
} as const;

/** Labels only; URLs come from the catalog and SEO.md URL scheme. The legacy "- " prefix of dropdown items is dropped. */
export const NAV = {
  home: 'Úvod',
  portfolio: 'Portfolio',
  weddings: 'Svatby',
  portraits: 'Portréty',
  couples: 'Párové focení',
  about: 'O mně',
  reference: 'Reference',
  contact: 'Kontakt',
  /** Header wordmark: the brand ("Mullny Photos") as one word, shown uppercase by `.t-wordmark`. */
  wordmark: 'MullnyPhotos',
} as const;

export const FOOTER = {
  brand: 'MULLNY',
  region: 'Fotím v Jihomoravském kraji',
} as const;

export const HOME = {
  categoriesTitle: 'KATEGORIE',
  categories: {
    weddings: 'SVATBY',
    portraits: 'PORTRÉTY',
    couples: 'PÁROVÉ FOCENÍ',
  },
  hello: {
    title: 'Vítejte na mé stránce',
    paragraphs: [
      'Vítejte na mých webových stránkách. Jmenuji se Terezie Müllnerová a jsem fotografka z Brna. Specializuji se na portrétní párové a svatební fotografie. Ráda zachytím krásné a autentické momenty, které Vám zůstanou v paměti díky fotografiím už navždy.',
      'Mým cílem je vytvořit příjemnou a uvolněnou atmosféru během focení, abych vás dokázala zachytit přirozeně a autenticky.',
    ],
  },
  quote:
    'Vzpomínky jsou pomíjivé, ale fotografie je dokáže zvěčnit navždy. Zachycuje podstatu okamžiku a umožňuje nám ho znovu a znovu prožívat. Když se díváme na fotografii, nevidíme jen obraz, ale cítíme emoce, které byly v danou chvíli přítomny. Fotografie je způsob, jak cítit, dotýkat se, milovat a navždy si uchovat tyto vzácné vzpomínky. To, co jste zachytili na fotografii, je zachyceno navždy... Pamatuje si drobnosti, i když jste už dávno všechno zapomněli.',
  reviewsTitle: 'RECENZE',
} as const;

export const ABOUT = {
  me: {
    title: 'O MNĚ',
    body: 'Jsem Terka a vítám Vás na své stránce. Již 5 let se věnuji fotografování. Nejdříve jsem se zaměřovala na fotografování přírody, která mě nikdy nepřestane fascinovat. Ovšem velice brzy jsem si uvědomila, že mnohem zábavnější a dechberoucí je zachytit úžasné chvíle mezi lidmi. Čas nejde zastavit, ale ve fotografii ho můžeme uchovat a kdykoliv se k ní vrátit a zavzpomínat. Lidské příběhy mohou být stejně úchvatné jako zapadající slunce na pláži a nebo výhled na vrcholu hory. Pojďme spolu zachytit váš den a ty úžasné okamžiky v něm. Věřím že naše spolupráce bude skvělý zážitek.',
  },
  experience: {
    title: 'MÉ ZKUŠENOSTI',
    // Q-1: the 46 000 / 12 000 / 4 000 claims are copied unchanged.
    body: 'Za dobu mé kariéry jsem stihla vyfotit přes 46 000 fotek portrétů, 12 000 fotek svateb a 4 000 fotek produktů. Absolvovala jsem kurz fotografování portrétů a nespočet kurzů na úpravu fotografií. Fotografování byl pro mě odjakživa koníček, ale před pár lety jsem se rozhodla svoje dovednosti prohloubit na profesionální úrovni a podstoupila jsem několika měsíční kurz, který mě pomohl najít mé vnímání fotografií. Díky tomuto kurzu, několikaletými zkušenostmi a desítkami nafocených svateb vám mohu nabídnout tu největší kvalitu, kterou si Vaše momenty zaslouží. Vždy se snažím zachytit lidi podle jejich představ a věřím, že správnou spoluprací lze dosáhnout skvělé výsledky.',
  },
  story: {
    title: 'MŮJ PŘIBĚH',
    body: 'Fotografování mě zaujalo již v dětství. Nejenže jsem si tajně půjčovala tátův foťák a fotila květiny a včely na balkóně, ale také jsem milovala staré fotoalba. Vždy jsem mohla hodiny sedět s rodinnými fotografiemi a prohlížet si okamžiky, které jsme prožili. Na fotografiích se mi líbí to, že se k nim kdykoliv můžu vrátit a zavzpomínat, co jsem zažila. Nebo skrz fotografie poznat mládí mých rodičů a to co oni zažívali. Vždy mě bavilo se dívat kolem sebe a všímat si detailů, které mnoho lidem utekly. Proto jsem se rozhodla je zachytit a tak zvěčnit ty jedinečné momenty plné emocí nebo i malých drobností v přírodě. Jedna z mých oblíbených činností je chodit do přírody a dívat se kolem sebe a čerpat tu jednoduchost a zároveň bohatství co se kolem nás skrývá.',
  },
} as const satisfies Record<string, TextBlock>;

export const CONTACT = {
  contact: {
    title: 'KONTAKT',
    body: 'Pokud máte zájem o nové fotografie nebo máte nějaké dotazy ohledně portrétů, svateb nebo produktů, neváhejte mě kontaktovat. Máte konkrétní představu, jak by měly fotografie vypadat? Skvěle, společně to dokážeme zrealizovat. Pokud ale žádné nápady zatím nemáte, nevadí! Můžeme společně vymyslet něco skvělého. Kontaktovat mě můžete přes Instagram nebo e-mail. Jakmile se dohodneme na všech podrobnostech, zašlu vám potvrzovací e-mail. Už se těším na naši spolupráci!',
    buttonLabel: MAIL_ADDRESS,
    buttonHref: MAIL_URL,
  },
  instagram: {
    title: 'INSTAGRAM',
    body: 'Neváhejte se podívat i na můj Instagram. Pravidelně na něj přidávám nové příspěvky a novinky. Najdete tam i moje fotografie, které na stránce nejsou. Například fotografie přírody nebo zvířat. Pokud by vás něco zaujalo, můžete mě přes něj kontaktovat.',
    buttonLabel: INSTAGRAM_HANDLE,
    buttonHref: INSTAGRAM_URL,
  },
} as const;

/** Replaces the English "This is non found" placeholder; title matches docs/SEO.md. */
export const NOT_FOUND = {
  title: 'Stránka nenalezena',
  body: 'Tuto stránku se nepodařilo najít. Vraťte se na úvod nebo si prohlédněte portfolio.',
} as const;

export const UOOU_URL = 'https://uoou.gov.cz';

/** Wording is ours (docs/ANALYTICS-CONSENT.md section 4, reduced to option C / D-3 and WP-3); open `[doplnit]` items are in docs/TEXTS-REVIEW.md. */
export const COOKIES = {
  title: 'Zásady cookies a ochrany soukromí',
  intro: 'Tato stránka vysvětluje, jaké údaje tento web zpracovává a komu je můžete nahlásit nebo se na ně zeptat.',
  controller: {
    title: 'Správce údajů',
    intro: 'Správcem osobních údajů je fotografka provozující web Mullny Photos.',
    nameLabel: 'Jméno a příjmení nebo obchodní jméno',
    addressLabel: 'Adresa',
    idLabel: 'IČO',
    /** Optional (T-220): a private person without IČO leaves it null and the line is omitted. Name, address and e-mail suffice. */
    companyId: null as string | null,
    mailLabel: 'E-mail',
    placeholder: '[doplnit]',
  },
  storage: {
    title: 'Co web ukládá',
    body: 'Web nepoužívá žádné cookies a neukládá do vašeho zařízení žádná data, ani v místním úložišti prohlížeče.',
  },
  hosting: {
    title: 'Hosting',
    body: 'Web běží na službách společnosti Cloudflare, která doručuje stránky a obrázky. Při načtení stránky zpracovává technické údaje nutné k doručení a zabezpečení, například IP adresu. Cloudflare provozuje servery po celém světě.',
  },
  fonts: {
    title: 'Písma',
    body: 'Písma jsou součástí webu a načítají se z něj. Web si je nestahuje od třetích stran.',
  },
  mail: {
    title: 'E-mailové dotazy',
    body: 'Když mi napíšete e-mail, použiji vaši adresu a obsah zprávy jen k odpovědi a domluvě focení. Na webu není žádný formulář. Odkazy na Instagram a MyWed vedou na cizí weby, které mají vlastní zásady.',
  },
  rights: {
    title: 'Vaše práva',
    body: 'Máte právo na přístup ke svým osobním údajům, jejich opravu nebo výmaz, omezení zpracování, vznesení námitky a přenositelnost. Napište mi na e-mail uvedený výše. Pokud se domníváte, že s údaji nakládám nesprávně, můžete podat stížnost u Úřadu pro ochranu osobních údajů.',
    complaintLabel: 'Úřad pro ochranu osobních údajů (uoou.gov.cz)',
    complaintHref: UOOU_URL,
  },
  /** Shown on /cookies/ only in a build that has the analytics beacon. Photographer approves the wording (docs/TEXTS-REVIEW.md). */
  ANALYTICS_TITLE: 'Měření návštěvnosti',
  ANALYTICS_PARAGRAPH:
    'Web měří návštěvnost službou Cloudflare Web Analytics. Měření nepoužívá cookies ani místní úložiště prohlížeče a neukládá do vašeho zařízení nic. Zpracovávají se jen souhrnné technické údaje o návštěvě, například zobrazená stránka, odkazující web, země, typ zařízení a prohlížeče a rychlost načtení stránky. Službu poskytuje společnost Cloudflare, která provozuje servery po celém světě. Údaje používám k tomu, abych poznala, které stránky návštěvníky zajímají a zda se web rychle načítá; právním základem je můj oprávněný zájem. Měření můžete zablokovat v prohlížeči nebo blokátorem obsahu, web funguje stejně i bez něj.',
} as const;

/**
 * AUDIT section 4 strings intentionally not carried over.
 * Each entry: legacy string and the reason.
 */
export const DROPPED_LEGACY: ReadonlyArray<{ readonly legacy: string; readonly reason: string }> = [
  { legacy: 'You need to enable JavaScript to run this app.', reason: 'The new site is static HTML and needs no JavaScript to read.' },
  { legacy: 'This is non found', reason: 'Replaced by NOT_FOUND (Czech).' },
  { legacy: 'Image', reason: 'Meaningless alt text; alt texts come from SEO rules.' },
  { legacy: 'Photo n', reason: 'Meaningless alt text; alt texts come from SEO rules.' },
  { legacy: 'Mullny photos (meta title)', reason: 'Titles come from seo.ts.' },
  { legacy: 'Portfólio (page title)', reason: 'Page titles come from seo.ts.' },
];
