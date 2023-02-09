const CategoryView = (props: {
  title: string;
  imgSrc: string;
  urlPath: string;
}) => {
  return (
    <div className="flex-none flex-shrink-0 mt-6 mx-5">
      <a href={props.urlPath}>
        <img
          className="object-cover h-80 w-60 xl:h-96 xl:w-72 "
          src={props.imgSrc}
          alt={props.title}
        />
        <p className="w-full pt-3 categoriesTitle">{props.title}</p>
      </a>
    </div>
  );
};

export default CategoryView;
