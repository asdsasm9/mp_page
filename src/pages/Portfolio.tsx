import CategoryView from "../components/home/CategoryView";
import Experience from "../components/home/Experience";
import usePageTitle from "../hooks/usePageTitle";
import ReactGA from "react-ga";

const Portfolio = () => {
  ReactGA.pageview("/portfolio");
  usePageTitle("Portfolio");

  return (
    <>
      <div className="mt-24">
        <p className="textHardTitle pl-10 md:pl-14">KATEGORIE</p>
        <div className="flex flex-wrap mx-10 md:mb-14 justify-between categoriesMainDiv">
          <CategoryView
            title="SVATBY"
            imgSrc="fotky_web/site/home/weddings.jpg"
            urlPath="/weddings"
          ></CategoryView>
          <CategoryView
            title="PORTRÉTY"
            imgSrc="fotky_web/site/home/portraits.jpg"
            urlPath="/portraits"
          ></CategoryView>
          <CategoryView
            title="PÁROVÉ FOCENÍ"
            imgSrc="fotky_web/site/home/couples.jpg"
            urlPath="/couples"
          ></CategoryView>
        </div>
      </div>

      <Experience></Experience>
    </>
  );
};

export default Portfolio;
