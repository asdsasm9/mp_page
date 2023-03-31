import { JsxElement } from "typescript";

export type buttonInfo = {
  title: string;
  urlHref: string;
};

const ContactView = (props: {
  title: string;
  imgSrc: string;
  description: string;
  textOnRight: boolean;
  button1: buttonInfo;
}) => {
  const button1 = (
    <div className="my-2 mt-5 xl:my-5 flex-none w-56 h-9 bg-mybtn rounded-md flex justify-center">
      <a href={props.button1.urlHref} className="mb-auto mt-auto ">
        {props.button1.title}
      </a>
    </div>
  );
  const myImg = (
    <img src={props.imgSrc} alt="Image" className="textContactImg" />
  );
  return (
    <div className="mb-5 mx-3 sm:mx-10 sm:flex items-center">
      <div
        className={`contactImgDiv contactImgDivFirst ${
          props.textOnRight ? "hidden" : "flex"
        }`}
      >
        {myImg}
      </div>

      <div className="w-100 px-10 p-10 sm:w-1/2 flex justify-center">
        <div className="textPartAbout text-justify sm:text-left">
          <p className="textAboutTitle">{props.title}</p>
          <p className="textAboutDescription pt-5">{props.description}</p>
          {button1}
        </div>
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

export default ContactView;
