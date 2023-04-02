import ReactGA from "react-ga4";

export enum AnalyticAction {
  COMPONENT = "ComponentClick",
  PAGE = "PageLoad",
  LINK = "Link clicked",
}

export const pushAnalysisEvent = (category: string, action: AnalyticAction) => {
  ReactGA.event({ category: category, action: action });
};

export const pushAnalysisPageChange = (pageId: string) => {
  return;
  console.log(pageId);
  ReactGA.send({
    hitType: "pageview",
    page: `/${pageId}`,
    title: "",
    legacyDimensionMetric: false,
  });
};
