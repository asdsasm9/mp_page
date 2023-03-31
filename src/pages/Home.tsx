import CategoryView from "../components/home/CategoryView";
import Experience from "../components/home/Experience";
import HelloView from "../components/home/HelloView";
import PhotoCollage from "../components/home/PhotoCollage";
import usePageTitle from "../hooks/usePageTitle";

const Home = () => {
  usePageTitle("Úvod");

  return (
    <>
      <div className="w-full">
        <img
          className="w-full object-cover mainTopImg"
          src="fotky_web/site/home/main.jpg"
          alt=""
        />
      </div>

      <HelloView></HelloView>

      <div className="CategoriesView">
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
      <PhotoCollage></PhotoCollage>

      <Experience></Experience>
    </>
  );
};

export default Home;
