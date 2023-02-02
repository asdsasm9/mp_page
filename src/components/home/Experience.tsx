import { AnickaReview, PatiReview } from "../../data/DataTexts";
import ExperienceColumn from "./ExperienceColumn";

const ExperienceView = () => {
  const absoluteTopTitle = "EXPERIENCES";

  return (
    <>
      <div className="md:pb-20 md:pt-14 md:flex">
        <ExperienceColumn
          review={PatiReview}
          absoluteTopTitle={absoluteTopTitle}
        />
        <div className="line"></div>
        <ExperienceColumn review={AnickaReview} absoluteTopTitle={""} />
      </div>
    </>
  );
};

export default ExperienceView;
