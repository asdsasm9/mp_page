import CategoryView from "../components/CategoryView";
import Experience from "../components/Experience";
import HelloView from "../components/HelloView";

const Home = () => {
  return (
    <>
      <div className="w-full">
        <img
          className="w-full max-h-120 object-cover"
          src="fotky_web/site/main/main.jpeg"
          alt=""
        />
      </div>

      <HelloView></HelloView>

      <p className="textHardTitle pl-14">KATEGORIE</p>
      <div className="mb-14 flex flex-wrap mx-10">
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

      <Experience></Experience>
    </>
  );
};

export default Home;
