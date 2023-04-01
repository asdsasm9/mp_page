import usePageTitle from "../hooks/usePageTitle";
import ReactGA from "react-ga";
import { useEffect } from "react";
import { pushAnalysisEvent, AnalyticAction } from "../data/AnalyticsHandler";

const NotFound = () => {
  usePageTitle("Nenaleznuto");
  useEffect(() => {
    ReactGA.pageview(window.location.pathname);
    pushAnalysisEvent(window.location.pathname, AnalyticAction.PAGE);
  }, []);

  return <p>This is non found</p>;
};

export default NotFound;
