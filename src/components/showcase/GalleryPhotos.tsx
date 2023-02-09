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

  let twoSides = (
    <>
      <div className="">
        {leftSide.map((imgSrc) => (
          <ShowcasePhoto key={imgSrc} imgSrc={imgSrc}></ShowcasePhoto>
        ))}
      </div>
      <div className="">
        {rightSide.map((imgSrc) => (
          <ShowcasePhoto key={imgSrc} imgSrc={imgSrc}></ShowcasePhoto>
        ))}
      </div>
    </>
  );

  let oneSide = (
    <div className="">
      {props.imgUrls.map((imgSrc) => (
        <ShowcasePhoto key={imgSrc} imgSrc={imgSrc}></ShowcasePhoto>
      ))}
    </div>
  );

  return (
    <>
      <p className="textHardTitle px-7 mt-12">{props.gallery.nameOfGallery}</p>
      <div className="md:hidden px-5">{oneSide}</div>
      <div className="hidden md:flex">{twoSides}</div>
    </>
  );
};

export default GalleryPhotos;
