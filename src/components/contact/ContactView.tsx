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
    <div className="my-2 xl:my-5 flex-none w-56 h-9 bg-mybtn rounded-md flex justify-center">
      <a href={props.button1.urlHref} className="mb-auto mt-auto ">
        {props.button1.title}
      </a>
    </div>
  );

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
        {button1}
      </div>
      {!props.textOnRight ? myImg : ""}
    </div>
  );
};

export default ContactView;
