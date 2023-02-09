import { useNavigate } from "react-router-dom";
import "./WeddingView.css";

const WeddingView = (props: {
  imgSrc: string;
  name: string;
  place: string;
  weddingUrl: string;
  textIsOnRight: boolean;
}) => {
  const navigate = useNavigate();

  const imgDiv = (
    <img src={props.imgSrc} alt={props.name} className="weddingViewImg" />
  );
  const divStyle = props.textIsOnRight ? "items-end" : "items-start";

  return (
    <>
      <div className="sm:flex">
        <div
          className={`weddingViewImgDiv weddingViewImgDivFirst ${
            props.textIsOnRight ? "hidden" : ""
          }`}
        >
          {imgDiv}
        </div>
        <div className="w-100 py-10 sm:w-1/2 flex justify-center">
          <div className="w-80">
            <div className={`sm:flex flex-col ${divStyle}`}>
              <h1 className="weddingViewName">{props.name}</h1>
              <p className="weddingViewPlace">{props.place}</p>
              <div className="py-3">
                <button
                  className="learnMore"
                  onClick={() => navigate(props.weddingUrl)}
                >
                  SHOW MORE
                </button>
              </div>
            </div>
          </div>
        </div>
        <div
          className={`weddingViewImgDiv weddingViewImgDivSecond ${
            !props.textIsOnRight ? "hidden" : ""
          }`}
        >
          {imgDiv}
        </div>
      </div>
    </>
  );
};

export default WeddingView;
