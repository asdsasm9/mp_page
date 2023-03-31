import { useNavigate } from "react-router-dom";
import { KnowMore } from "../../data/Translations";

const HelloView = () => {
  const title = "Vítejte na mé stránce";

  const description1 =
    "Vítejte na mých webových stránkách. Jmenuji se Terezie Müllnerová a jsem fotografka z Brna. Specializuji se na portrétní párové a svatební fotografie. Ráda zachytím krásné a autentické momenty, které Vám zůstanou v paměti díky fotografiím už navždy. ";
  const description2 =
    "Mým cílem je vytvořit příjemnou a uvolněnou atmosféru během focení, abych vás dokázala zachytit přirozeně a autenticky. ";

  const navigate = useNavigate();
  return (
    <>
      <div className="mt-10 md:flex items-center">
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
