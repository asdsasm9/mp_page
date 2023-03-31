import "./PhotoCollage.css";
import { useState } from "react";

const PhotoCollage = () => {
  const titleText = "";
  const mainText =
    "Vzpomínky jsou pomíjivé, ale fotografie je dokáže zvěčnit navždy. Zachycuje podstatu okamžiku a umožňuje nám ho znovu a znovu prožívat. Když se díváme na fotografii, nevidíme jen obraz, ale cítíme emoce, které byly v danou chvíli přítomny. Fotografie je způsob, jak cítit, dotýkat se, milovat a navždy si uchovat tyto vzácné vzpomínky. To, co jste zachytili na fotografii, je zachyceno navždy... Pamatuje si drobnosti, i když jste už dávno všechno zapomněli.";

  const [photos, setPhotos] = useState([
    {
      id: 1,
      src: "fotky_web/site/home/trio1.jpg",
    },
    {
      id: 2,
      src: "fotky_web/site/home/trio2.jpg",
    },
    { id: 3, src: "fotky_web/site/home/trio3.jpg" },
  ]);
  const shuffledPhotos = photos; //photos.sort(() => Math.random() - 0.5);
  //${photo.xT}, ${photo.yT})
  return (
    <div className="collage pt-10 mb-10 lg:pl-14">
      <p className="textHardTitle px-10 w-full lg:px-0">{titleText}</p>
      <p className="textExperience px-10 pt-5 h-full md:w-1/3 lg:px-0 text-justify sm:text-left">
        {mainText}
      </p>
      {shuffledPhotos.map((photo, index) => (
        <img
          key={photo.id}
          src={photo.src}
          className={`collageImg img${index + 1}`}
          alt={`Photo ${photo.id}`}
        />
      ))}
    </div>
  );
};

export default PhotoCollage;
