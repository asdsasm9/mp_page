import { BASE_URL } from "../../data/Translations";

const ShowcasePhoto = (props: { imgSrc: string }) => {
  return (
    <img
      className="p-2"
      src={BASE_URL + `/${props.imgSrc}`}
      alt={props.imgSrc}
    />
  );
};
export default ShowcasePhoto;
