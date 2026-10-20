/**
 * Czech UI dictionary of the admin (docs/ADMIN-UX.md sections 2, 3 and 7). Every sentence the
 * photographer reads lives under src/i18n; components only look words up here. Tone: short,
 * polite "vy" form, no jargon ("adresa", not "slug").
 */

/** Glossary words of ADMIN-UX section 7, one entry per word. */
export const glossary = {
  logIn: 'Přihlásit se',
  logOut: 'Odhlásit se',
  email: 'E-mail',
  password: 'Heslo',
  forgotPassword: 'Zapomenuté heslo',
  categories: 'Kategorie',
  newCategory: 'Nová kategorie',
  album: 'Album',
  albums: 'Alba',
  newAlbum: 'Nové album',
  photos: 'Fotky',
  choosePhotos: 'Vybrat fotky',
  name: 'Název',
  address: 'Adresa',
  place: 'Místo',
  shotOn: 'Datum focení',
  description: 'Popis',
  caption: 'Popisek',
  altText: 'Alternativní text',
  forSearchEngines: 'Pro vyhledávače',
  seoTitle: 'SEO titulek',
  seoDescription: 'SEO popis',
  coverPhoto: 'Titulní fotka',
  setAsCover: 'Nastavit jako titulní',
  publishAlbum: 'Zveřejnit album',
  hideAlbum: 'Skrýt album',
  publishSite: 'Zveřejnit web',
  published: 'Zveřejněno',
  draft: 'Koncept',
  hidden: 'Skryto',
  visible: 'Viditelná',
  hiddenCategory: 'Skrytá',
  delete: 'Smazat',
  cancel: 'Zrušit',
  save: 'Uložit',
  saved: 'Uloženo',
  retry: 'Zkusit znovu',
  move: 'Přesunout',
  moveToAlbum: 'Přesunout do alba',
  moveUp: 'Posunout nahoru',
  moveDown: 'Posunout dolů',
  uploading: 'Nahrávání',
  queued: 'Ve frontě',
  processing: 'Zpracovávám',
  uploadingNow: 'Nahrávám',
  done: 'Hotovo',
  storage: 'Úložiště',
  checkStorage: 'Zkontrolovat úložiště',
  details: 'Podrobnosti',
} as const;

export const cs = {
  glossary,
  app: {
    name: 'Mullny Photos – správa',
    titleSeparator: ' – ',
  },
  skipLink: 'Přejít na obsah',
  nav: {
    main: 'Hlavní navigace',
    bottom: 'Spodní navigace',
    categories: glossary.categories,
    upload: glossary.uploading,
    storage: glossary.storage,
    publish: 'Zveřejnit',
    publishSite: glossary.publishSite,
  },
  routes: {
    login: { title: 'Přihlášení' },
    categories: { title: glossary.categories },
    category: { title: 'Kategorie' },
    album: { title: glossary.album },
    photo: { title: 'Fotka' },
    publish: { title: glossary.publishSite },
    storage: { title: glossary.storage },
    upload: { title: glossary.uploading },
  },
  placeholder: {
    body: 'Tato obrazovka se připravuje.',
  },
  notFound: {
    title: 'Stránka nenalezena',
    body: 'Tuto stránku jsme nenašli.',
    back: 'Zpět na kategorie',
  },
  /** Plural forms (jedno, 2 až 4, 5 a více) for counted nouns. */
  units: {
    photo: ['fotka', 'fotky', 'fotek'],
    album: ['album', 'alba', 'alb'],
    second: ['sekunda', 'sekundy', 'sekund'],
  },
} as const;

export type Dictionary = typeof cs;
