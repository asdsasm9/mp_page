import { useParams } from "react-router-dom";
import GalleryPhotos from "../components/showcase/GalleryPhotos";
import ShowcasePhoto from "../components/showcase/ShowcasePhoto";
import { Category, Gallery } from "../data/Data";
import {
  getAllCouples,
  getAllImagesPaths,
  getAllPortraits,
  getByGalleryId,
  getMainImagePath,
} from "../data/DataHandler";

const PhotosShowcase = (props: { category: Category }) => {
  const params = useParams();
  let showingGalleries: Gallery[] = [];

  if (props.category == Category.WEDDING) {
    const weddingId = params["wed"];
    showingGalleries = [getByGalleryId(weddingId!)];
  } else if (props.category === Category.PORTRAITS) {
    showingGalleries = getAllPortraits();
  } else if (props.category === Category.COUPLES) {
    showingGalleries = getAllCouples();
  }

  return (
    <>
      <div className="mt-12">
        {showingGalleries.map((gallery) => (
          <GalleryPhotos
            imgUrls={getAllImagesPaths(gallery)}
            gallery={gallery}
          ></GalleryPhotos>
        ))}
      </div>
    </>
  );
};

export default PhotosShowcase;
