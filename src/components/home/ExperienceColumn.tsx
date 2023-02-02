import { getMainImagePath } from "../../data/DataHandler";
import { Review } from "../../data/DataTexts";

const ExperienceColumn = (props: {
  absoluteTopTitle: string;
  review: Review;
}) => {
  const gallery = props.review.gallery;
  const description = props.review.description;
  return (
    <div className="w-full px-10 py-5 md:py-10 flex justify-center md:w-1/2">
      <div className="experienceColumn w-50 ">
        <p className="textHardTitle experienceTitle">
          {props.absoluteTopTitle}
        </p>
        <img
          className="reviewImg w-50"
          src={getMainImagePath(gallery)}
          alt={gallery.nameOfGallery}
        />
        <p className="experiencesName">{gallery.nameOfGallery}</p>
        <p className="experiencesPlace">{gallery.placeName}</p>
        <p className="textExperience">{description}</p>
      </div>
    </div>
  );
};

export default ExperienceColumn;
