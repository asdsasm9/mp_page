import { useNavigate } from "react-router-dom";
import { KnowMore } from "../../data/Translations";

const HelloView = () => {
  const title = "VÍTEJTE";

  const description1 =
    "Jmenuji se Terka a vítám vas na mé stránce. Za 5 let fotografování jsem vytvořila tisíce fotografií přírody a lidí. Fotím po celém Jihomoravském kraji a to především svatby, portréty a produkty.";
  const description2 =
    "Součástí focení je zaručena příjemná atmosféra. Nejdůležitější je zjistit vaše představy a zrealizovat je. Poté zajistit vše potřebné pro nejlepší výsledek fotografií a příjemný zážitek. Následně fotografie upravím a pak vám je pošlu.";

  const navigate = useNavigate();
  return (
    <>
      <div className="mt-10 md:flex">
        <div className="w-100 p-4 py-7 px-10 md:pl-20 md:px-0 md:w-1/2 flex justify-center">
          <div className="textPartAbout text-justify sm:text-left">
            <p className="textHardTitle w-100 pb-3">{title}</p>
            <p className="textBasic md:mt-4 ">{description1}</p>
            <div className="spacer" />
            <p className="mt-4 textBasic">{description2}</p>
            <div className="py-3">
              <button className="learnMore" onClick={() => navigate("/about")}>
                {KnowMore}
              </button>
            </div>
          </div>
        </div>
        <div className="w-100 p-5 pt-0 flex items-center md:w-1/2 md:pt-5">
          <img
            src="fotky_web/site/home/hello.jpg"
            alt="Image"
            className="helloViewImg"
          />
        </div>
      </div>
    </>
  );
};

export default HelloView;
