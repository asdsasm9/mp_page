import { prototype } from "events";
import "./AboutView.css";

const AboutView = (props: {
  title: string;
  imgSrc: string;
  description: string;
  textOnRight: boolean;
}) => {
  const myImg = (
    <div className="w-1/2 p-4">
      <img src={props.imgSrc} alt="Image" className="textAboutImg" />
    </div>
  );
  return (
    <div className="flex mx-10 mb-10">
      {props.textOnRight ? myImg : ""}
      <div className="w-1/2 px-10 p-10">
        <p className="textAboutTitle pt-3">{props.title}</p>
        <p className="textAboutDescription pt-10">{props.description}</p>
      </div>
      {!props.textOnRight ? myImg : ""}
    </div>
  );
};

export default AboutView;
