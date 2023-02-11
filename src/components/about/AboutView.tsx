import { prototype } from "events";
import "./AboutView.css";

const AboutView = (props: {
  title: string;
  imgSrc: string;
  description: string;
  textOnRight: boolean;
}) => {
  const myImg = <img src={props.imgSrc} alt="Image" className="textAboutImg" />;
  return (
    <div className="mb-5 mx-3 sm:mx-10 sm:flex">
      <div
        className={`aboutImgDiv aboutImgDivFirst ${
          props.textOnRight ? "hidden" : "flex"
        }`}
      >
        {myImg}
      </div>

      <div className="w-100 px-10 p-10 sm:w-1/2 flex justify-center text-justify sm:text-left">
        <div className="textPartAbout">
          <p className="textAboutTitle">{props.title}</p>
          <p className="textAboutDescription pt-5">{props.description}</p>
        </div>
      </div>
      <div
        className={`aboutImgDiv aboutImgDivSecond ${
          !props.textOnRight ? "hidden" : "flex"
        }`}
      >
        {myImg}
      </div>
    </div>
  );
};

export default AboutView;
