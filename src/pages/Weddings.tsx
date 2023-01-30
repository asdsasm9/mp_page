import WeddingView from "../components/weddings/WeddingView";
import { getAllWeddings, getMainImagePath } from "../data/DataHandler";

const Weddings = () => {
  return (
    <div className="pt-20">
      {getAllWeddings().map((wedding) => (
        <WeddingView
          key={wedding.id}
          imgSrc={getMainImagePath(wedding)}
          name={wedding.nameOfGallery}
          place={wedding.placeName}
          weddingUrl={wedding.id}
        ></WeddingView>
      ))}
    </div>
  );
};

export default Weddings;
