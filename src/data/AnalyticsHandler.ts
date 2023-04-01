import ReactGA from "react-ga";

export enum AnalyticAction {
  COMPONENT = "ComponentClick",
  PAGE = "PageLoad",
  LINK = "Link clicked",
}

export const pushAnalysisEvent = (category: string, action: AnalyticAction) => {
  ReactGA.event({ category: category, action: action });
};
