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
export const frankovi: Gallery = {
  id: "frankovi",
  placeName: "",
  nameOfGallery: "Michal & Rozárka Frankovi",
  type: Category.WEDDING,
  numOfImages: 5,
  mainImgNum: 1,
};

export const hradsti: Gallery = {
  id: "hradsti",
  placeName: "",
  nameOfGallery: "Hradští",
  type: Category.WEDDING,
  numOfImages: 8,
  mainImgNum: 1,
};

export const sedlakovi: Gallery = {
  id: "sedlakovi",
  placeName: "",
  nameOfGallery: "Sedlakovi",
  type: Category.WEDDING,
  numOfImages: 10,
  mainImgNum: 1,
};

export const suranovi: Gallery = {
  id: "suranovi",
  placeName: "",
  nameOfGallery: "Suranovi",
  type: Category.WEDDING,
  numOfImages: 5,
  mainImgNum: 1,
};

//PORTRAITS
export const anez: Gallery = {
  id: "anez",
  placeName: "",
  nameOfGallery: "Anež",
  type: Category.PORTRAITS,
  numOfImages: 9,
  mainImgNum: 1,
};

const jumping: Gallery = {
  id: "jumping",
  placeName: "",
  nameOfGallery: "Jumping",
  type: Category.PORTRAITS,
  numOfImages: 5,
  mainImgNum: 1,
};

const lukas: Gallery = {
  id: "lukas",
  placeName: "",
  nameOfGallery: "Lukáš",
  type: Category.PORTRAITS,
  numOfImages: 7,
  mainImgNum: 1,
};
const mia: Gallery = {
  id: "mia",
  placeName: "",
  nameOfGallery: "Mia",
  type: Category.PORTRAITS,
  numOfImages: 20,
  mainImgNum: 1,
};

export const pati: Gallery = {
  id: "pati",
  placeName: "",
  nameOfGallery: "Pati",
  type: Category.PORTRAITS,
  numOfImages: 12,
  mainImgNum: 1,
};

const pati2: Gallery = {
  id: "pati2",
  placeName: "",
  nameOfGallery: "Pati kavárna",
  type: Category.PORTRAITS,
  numOfImages: 4,
  mainImgNum: 1,
};

//COUPLES
const helis_tom: Gallery = {
  id: "helis_tom",
  placeName: "",
  nameOfGallery: "Helis & Tom",
  type: Category.COUPLES,
  numOfImages: 6,
  mainImgNum: 1,
};

const lucka: Gallery = {
  id: "lucka",
  placeName: "Brno",
  nameOfGallery: "Lucka",
  type: Category.COUPLES,
  numOfImages: 5,
  mainImgNum: 1,
};
const mentoring: Gallery = {
  id: "mentoring",
  placeName: "",
  nameOfGallery: "Mentoring",
  type: Category.COUPLES,
  numOfImages: 11,
  mainImgNum: 1,
};

export const allGalleries: Gallery[] = [
  frankovi,
  hradsti,
  sedlakovi,
  suranovi,
  anez,
  jumping,
  lukas,
  mia,
  pati,
  pati2,
  helis_tom,
  lucka,
  mentoring,
];
