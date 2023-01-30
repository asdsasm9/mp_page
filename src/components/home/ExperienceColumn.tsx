import { getMainImagePath } from "../../data/DataHandler";
import { Review } from "../../data/DataTexts";

const ExperienceColumn = (props: {
  absoluteTopTitle: string;
  review: Review;
}) => {
  const gallery = props.review.gallery;
  const description = props.review.description;
  return (
    <div className="left-side flex justify-center">
      <div className="experienceColumn ">
        <p className="textHardTitle" style={{ height: "80px" }}>
          {props.absoluteTopTitle}
        </p>
        <img
          className="reviewImg w-100"
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
