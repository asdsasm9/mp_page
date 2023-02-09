import { prototype } from "events";
import "./AboutView.css";

const AboutView = (props: {
  title: string;
  imgSrc: string;
  description: string;
  textOnRight: boolean;
}) => {
  const myImg = (
    <img src={props.imgSrc} alt="Image" className="textContactImg" />
  );
  return (
    <div className="mb-5 mx-3 sm:mx-10 sm:flex">
      <div
        className={`contactImgDiv contactImgDivFirst ${
          props.textOnRight ? "hidden" : "flex"
        }`}
      >
        {myImg}
      </div>

      <div className="w-100 px-10 p-10 sm:w-1/2">
        <p className="textAboutTitle">{props.title}</p>
        <p className="textAboutDescription pt-5">{props.description}</p>
      </div>
      <div
        className={`contactImgDiv contactImgDivSecond ${
          !props.textOnRight ? "hidden" : "flex"
        }`}
      >
        {myImg}
      </div>
    </div>
  );
};

export default AboutView;
