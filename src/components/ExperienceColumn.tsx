const ExperienceColumn = (props: {
  absoluteTopTitle: string;
  imgSrc: string;
  name: string;
  place: string;
  description: string;
}) => {
  return (
    <div className="left-side flex justify-center">
      <div className="experienceColumn ">
        <p className="textHardTitle" style={{ height: "80px" }}>
          {props.absoluteTopTitle}
        </p>
        <img className="reviewImg w-100" src={props.imgSrc} alt={props.name} />
        <p className="experiencesName">{props.name}</p>
        <p className="experiencesPlace">{props.place}</p>
        <p className="textExperience">{props.description}</p>
      </div>
    </div>
  );
};

export default ExperienceColumn;
