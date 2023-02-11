import usePageTitle from "../hooks/usePageTitle";

const NotFound = () => {
  usePageTitle("Nenaleznuto");
  return <p>This is non found</p>;
};

export default NotFound;
