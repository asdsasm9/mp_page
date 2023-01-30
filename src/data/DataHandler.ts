import { allGalleries, Category, Gallery } from "./Data";

export const getAllWeddings = (): Gallery[] => {
  return allGalleries.filter((gallery) => gallery.type === Category.WEDDING);
};

export const getAllPortraits = (): Gallery[] => {
  return allGalleries.filter((gallery) => gallery.type === Category.PORTRAITS);
};

export const getAllCouples = (): Gallery[] => {
  return allGalleries.filter((gallery) => gallery.type === Category.COUPLES);
};

export const getMainImagePath = (gallery: Gallery): string => {
  const categoryString = gallery.type;
  const galleryId = gallery.id;
  const imgNum = gallery.mainImgNum;
  const fin = `fotky_web/galleries/${categoryString}/${galleryId}/${imgNum}.jpg`;
  return fin;
};

export const getAllImagesPaths = (gallery: Gallery): string[] => {
  const categoryString = gallery.type;
  const galleryId = gallery.id;

  let allUrls: string[] = [];
  for (let i = 1; i <= gallery.numOfImages; i++) {
    const fin = `fotky_web/galleries/${categoryString}/${galleryId}/${i}.jpg`;
    allUrls.push(fin);
  }
  return allUrls;
};

export const getByGalleryId = (id: string): Gallery => {
  return allGalleries.filter((gallery) => gallery.id === id)[0];
};
