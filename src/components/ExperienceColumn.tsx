const ExperienceColumn = (props: {
  imgSrc: string;
  title: string;
  description: string;
}) => {
  return (
    <div className="left-side mx-20">
      <img className="reviewImg w-100" src={props.imgSrc} alt={props.title} />
      <p className="experiencesTitle">{props.title}</p>
      <p className="textBasic">{props.description}</p>
    </div>
  );
};

export default ExperienceColumn;
