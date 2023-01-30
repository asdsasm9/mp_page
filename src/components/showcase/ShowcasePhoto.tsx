const ShowcasePhoto = (props: { imgSrc: string }) => {
  return <img className="p-2" src={`/../${props.imgSrc}`} alt={props.imgSrc} />;
};

export default ShowcasePhoto;
