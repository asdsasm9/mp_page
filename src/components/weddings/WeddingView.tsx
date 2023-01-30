import { useNavigate } from "react-router-dom";
import "./WeddingView.css";

const WeddingView = (props: {
  imgSrc: string;
  name: string;
  place: string;
  weddingUrl: string;
}) => {
  const navigate = useNavigate();
  return (
    <>
      <div className="flex">
        <div className="w-1/2 py-10">
          <div className="relative right-0 ">
            <div className="flex flex-col items-end">
              <h1 className="weddingViewName">{props.name}</h1>
              <p className="weddingViewPlace">{props.place}</p>
              <div className="py-3">
                <button
                  className="learnMore"
                  onClick={() => navigate(props.weddingUrl)}
                >
                  LEARN MORE
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="w-1/2 p-10">
          <img src={props.imgSrc} alt={props.name} className="weddingViewImg" />
        </div>
      </div>
    </>
  );
};

export default WeddingView;
