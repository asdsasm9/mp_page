import CategoryView from "../components/home/CategoryView";
import Experience from "../components/home/Experience";
import HelloView from "../components/home/HelloView";
import PhotoCollage from "../components/home/PhotoCollage";

const Home = () => {
  return (
    <>
      <div className="w-full">
        <img
          className="w-full object-cover homeMainImg"
          src="fotky_web/site/main/main.jpeg"
          alt=""
        />
      </div>

      <HelloView></HelloView>

      <p className="textHardTitle pl-10 md:pl-14">KATEGORIE</p>
      <div className="flex flex-wrap mx-10 md:mb-14">
        <CategoryView
          title="SVADBY"
          imgSrc="fotky_web/site/main/svadby.png"
        ></CategoryView>
        <CategoryView
          title="PORTRÉTY"
          imgSrc="fotky_web/site/main/portrety.png"
        ></CategoryView>
        <CategoryView
          title="PRODUKTY"
          imgSrc="fotky_web/site/main/produkty.png"
        ></CategoryView>
      </div>
      <PhotoCollage></PhotoCollage>

      <Experience></Experience>
    </>
  );
};

export default Home;
