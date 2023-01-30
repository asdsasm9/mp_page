import WeddingView from "../components/weddings/WeddingView";

const Weddings = () => {
  return (
    <div className="pt-20">
      <WeddingView
        imgSrc={"fotky_web/site/weddingMain.jpeg"}
        name={"TITO & JON"}
        place={"The resort at Blue Sky"}
        weddingUrl={"url"}
      ></WeddingView>
      <WeddingView
        imgSrc={"fotky_web/site/weddingMain.jpeg"}
        name={"TITO & JON"}
        place={"The resort at Blue Sky"}
        weddingUrl={"url"}
      ></WeddingView>
      <WeddingView
        imgSrc={"fotky_web/site/weddingMain.jpeg"}
        name={"TITO & JON"}
        place={"The resort at Blue Sky"}
        weddingUrl={"url"}
      ></WeddingView>
    </div>
  );
};

export default Weddings;
