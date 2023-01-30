export enum Category {
  WEDDING = "weddings",
  COUPLES = "couples",
  PORTRAITS = "portraits",
}

export type Gallery = {
  id: string;
  placeName: string;
  nameOfGallery: string;
  type: Category;
  numOfImages: number;
  mainImgNum: number;
};

//WEDDINGS
const martin_kamca: Gallery = {
  id: "martin_kamca",
  placeName: "Brno",
  nameOfGallery: "Martin & Kamča",
  type: Category.WEDDING,
  numOfImages: 16,
  mainImgNum: 1,
};

//PORTRAITS
const lukas: Gallery = {
  id: "lukas",
  placeName: "Brno",
  nameOfGallery: "Lukáš",
  type: Category.PORTRAITS,
  numOfImages: 6,
  mainImgNum: 1,
};

const pati: Gallery = {
  id: "pati",
  placeName: "Brno",
  nameOfGallery: "Lukáš",
  type: Category.PORTRAITS,
  numOfImages: 6,
  mainImgNum: 1,
};

//COUPLES
const roman_anicka: Gallery = {
  id: "roman_anicka",
  placeName: "Brno",
  nameOfGallery: "Roman & Anička",
  type: Category.COUPLES,
  numOfImages: 10,
  mainImgNum: 1,
};

export const allGalleries: Gallery[] = [roman_anicka, lukas, martin_kamca];
