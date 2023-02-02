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
    <div className="w-1/2 p-10">
      <img src={props.imgSrc} alt={props.name} className="weddingViewImg" />
    </div>
  );
  const divStyle = props.textIsOnRight ? "items-end" : "items-start";

  return (
    <>
      <div className="flex">
        {!props.textIsOnRight ? imgDiv : ""}
        <div className="w-1/2 py-10">
          <div className="relative right-0 ">
            <div className={`flex flex-col ${divStyle}`}>
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
        {props.textIsOnRight ? imgDiv : ""}
      </div>
    </>
  );
};

export default WeddingView;
