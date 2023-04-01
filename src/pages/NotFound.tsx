import usePageTitle from "../hooks/usePageTitle";
import ReactGA from "react-ga";

const NotFound = () => {
  ReactGA.pageview("/not_found");
  usePageTitle("Nenaleznuto");

  return <p>This is non found</p>;
};

export default NotFound;
