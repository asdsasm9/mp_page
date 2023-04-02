import { useEffect } from "react";
import { useParams } from "react-router-dom";
import GalleryPhotos from "../components/showcase/GalleryPhotos";
import {
  AnalyticAction,
  pushAnalysisEvent,
  pushAnalysisPageChange,
} from "../data/AnalyticsHandler";
import { Category, Gallery } from "../data/Data";
import {
  getAllCouples,
  getAllImagesPaths,
  getAllPortraits,
  getByGalleryId,
} from "../data/DataHandler";
import usePageTitle from "../hooks/usePageTitle";

const PhotosShowcase = (props: { category: Category }) => {
  usePageTitle("Fotogalerie");

  const pageId = "showcase";
  useEffect(() => {
    pushAnalysisPageChange(pageId);
    pushAnalysisEvent(pageId, AnalyticAction.PAGE);
  }, []);

  const params = useParams();
  let showingGalleries: Gallery[] = [];

  if (props.category == Category.WEDDING) {
    const weddingId = params["wedding_id"];
    showingGalleries = [getByGalleryId(weddingId!)];
  } else if (props.category === Category.PORTRAITS) {
    showingGalleries = getAllPortraits();
  } else if (props.category === Category.COUPLES) {
    showingGalleries = getAllCouples();
  }

  return (
    <>
      <div className="mt-12 mb-10 sm:mt-20">
        {showingGalleries.map((gallery) => (
          <GalleryPhotos
            key={gallery.id}
            imgUrls={getAllImagesPaths(gallery)}
            gallery={gallery}
          ></GalleryPhotos>
        ))}
      </div>
    </>
  );
};

export default PhotosShowcase;
