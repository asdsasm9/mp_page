import { useEffect } from "react";
import WeddingView from "../components/weddings/WeddingView";
import {
  AnalyticAction,
  pushAnalysisEvent,
  pushAnalysisPageChange,
} from "../data/AnalyticsHandler";
import { getAllWeddings, getMainImagePath } from "../data/DataHandler";
import usePageTitle from "../hooks/usePageTitle";

const Weddings = () => {
  usePageTitle("Svatby");

  const pageId = "weddings";
  useEffect(() => {
    pushAnalysisPageChange(pageId);
    pushAnalysisEvent(pageId, AnalyticAction.PAGE);
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
