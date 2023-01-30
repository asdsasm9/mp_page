import { Gallery } from "../../data/Data";
import ShowcasePhoto from "./ShowcasePhoto";

const GalleryPhotos = (props: { imgUrls: string[]; gallery: Gallery }) => {
  let leftSide: string[] = [];
  let rightSide: string[] = [];

  for (let i = 0; i < props.imgUrls.length; i++) {
    if (i % 2 == 0) {
      leftSide.push(props.imgUrls[i]);
    } else {
      rightSide.push(props.imgUrls[i]);
    }
  }

  return (
    <>
      <p className="textHardTitle ml-4 mt-12">{props.gallery.nameOfGallery}</p>
      <div className="flex">
        <div className="w-1/2">
          {leftSide.map((imgSrc) => (
            <ShowcasePhoto imgSrc={imgSrc}></ShowcasePhoto>
          ))}
        </div>
        <div className="w-1/2">
          {rightSide.map((imgSrc) => (
            <ShowcasePhoto imgSrc={imgSrc}></ShowcasePhoto>
          ))}
        </div>
      </div>
    </>
  );
};

export default GalleryPhotos;
