import "./PhotoCollage.css";
import { useState } from "react";

const PhotoCollage = () => {
  const [photos, setPhotos] = useState([
    {
      id: 1,
      src: "fotky_web/site/o_mne/chces_fotku.png",
    },
    {
      id: 2,
      src: "fotky_web/site/about.jpeg",
    },
    { id: 3, src: "fotky_web/site/main/helllo.jpeg" },
  ]);
  const shuffledPhotos = photos; //photos.sort(() => Math.random() - 0.5);
  //${photo.xT}, ${photo.yT})
  return (
    <div className="collage pl-14 pt-10">
      <p className="textHardTitle w-full">THIS IS TITLE</p>
      <p className="textExperience pt-5 h-full w-1/3">
        S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší
        situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy
        přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z
        výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a
        zábavné. Dokáže zach
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
