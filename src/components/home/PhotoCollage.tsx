import "./PhotoCollage.css";
import { useState } from "react";

const PhotoCollage = () => {
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
      <p className="textHardTitle px-10 w-full lg:px-0">
        CHTĚLI BYSTE VYFOTIT?
      </p>
      <p className="textExperience px-10 pt-5 h-full md:w-1/3 lg:px-0 text-justify sm:text-left">
        Možná by bylo dobré mít skvělou profilovku na sociálních sítích, nebo by
        jste si chtěl rozšřit své portfolio. Nebo pokud je právě ten den kdy se
        rozhodujete jako bude vypadat vaše svatba, neváhejte mě kontaktovat a
        všechny detaily domyslíme.
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
