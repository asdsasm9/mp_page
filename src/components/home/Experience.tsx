import { AnickaReview, PatiReview } from "../../data/DataTexts";
import ExperienceColumn from "./ExperienceColumn";

const ExperienceView = () => {
  const absoluteTopTitle = "EXPERIENCES";

  return (
    <>
      <div className="flex pb-20 pt-20">
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
