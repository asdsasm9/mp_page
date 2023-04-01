import WeddingView from "../components/weddings/WeddingView";
import { getAllWeddings, getMainImagePath } from "../data/DataHandler";
import usePageTitle from "../hooks/usePageTitle";
import ReactGA from "react-ga";
import { useEffect } from "react";

const Weddings = () => {
  usePageTitle("Svatby");
  useEffect(() => {
    ReactGA.pageview(window.location.pathname);
  }, []);

  return (
    <div className="pt-20">
      {getAllWeddings().map((wedding, index) => (
        <WeddingView
          key={index}
          imgSrc={getMainImagePath(wedding)}
          name={wedding.nameOfGallery}
          place={wedding.placeName}
          weddingUrl={wedding.id}
          textIsOnRight={index % 2 === 0}
        ></WeddingView>
      ))}
    </div>
  );
};

export default Weddings;
