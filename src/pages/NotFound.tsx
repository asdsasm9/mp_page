import usePageTitle from "../hooks/usePageTitle";
import ReactGA from "react-ga";
import { useEffect } from "react";

const NotFound = () => {
  usePageTitle("Nenaleznuto");
  useEffect(() => {
    ReactGA.pageview(window.location.pathname);
  }, []);

  return <p>This is non found</p>;
};

export default NotFound;
