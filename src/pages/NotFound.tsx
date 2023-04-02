import { useEffect } from "react";
import {
  AnalyticAction,
  pushAnalysisEvent,
  pushAnalysisPageChange,
} from "../data/AnalyticsHandler";
import usePageTitle from "../hooks/usePageTitle";

const NotFound = () => {
  usePageTitle("Nenaleznuto");

  const pageId = "not_found";
  useEffect(() => {
    pushAnalysisPageChange(pageId);
    pushAnalysisEvent(pageId, AnalyticAction.PAGE);
  }, []);

  return <p>This is non found</p>;
};

export default NotFound;
