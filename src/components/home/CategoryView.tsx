import { useNavigate } from "react-router-dom";

const CategoryView = (props: {
  title: string;
  imgSrc: string;
  urlPath: string;
}) => {
  let navigate = useNavigate();

  return (
    <div
      className="flex-none flex-shrink-0 mt-6 mx-5 cursor-pointer"
      onClick={() => {
        navigate(props.urlPath);
      }}
    >
      <img
        className="object-cover h-80 w-60 xl:h-96 xl:w-72 "
        src={props.imgSrc}
        alt={props.title}
      />
      <p className="w-full pt-3 categoriesTitle">{props.title}</p>
    </div>
  );
};

export default CategoryView;
