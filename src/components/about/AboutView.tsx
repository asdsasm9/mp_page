import { prototype } from "events";
import "./AboutView.css";

const AboutView = (props: {
  title: string;
  imgSrc: string;
  description: string;
  textOnRight: boolean;
}) => {
  const myImg = (
    <div className="w-full md:w-1/2 p-4 items-center flex">
      <img src={props.imgSrc} alt="Image" className="textAboutImg" />
    </div>
  );
  return (
    <div className="md:flex mx-10 mb-10">
      {props.textOnRight ? myImg : ""}
      <div className="w-full p-4 md:1/2 md:px-10 md:p-10">
        <p className="textAboutTitle md:pt-3">{props.title}</p>
        <p className="textAboutDescription pt-4 md:pt-10">
          {props.description}
        </p>
      </div>
      {!props.textOnRight ? myImg : ""}
    </div>
  );
};

export default AboutView;
