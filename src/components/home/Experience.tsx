import { AnezReview, PatiReview } from "../../data/DataTexts";
import ExperienceColumn from "./ExperienceColumn";

const ExperienceView = () => {
  const absoluteTopTitle = "RECENZE";

  return (
    <>
      <div className="md:pb-20 md:pt-14 md:flex lg:pt-48">
        <ExperienceColumn
          review={PatiReview}
          absoluteTopTitle={absoluteTopTitle}
        />
        <div className="line"></div>
        <ExperienceColumn review={AnezReview} absoluteTopTitle={""} />
      </div>
    </>
  );
};

export default ExperienceView;
