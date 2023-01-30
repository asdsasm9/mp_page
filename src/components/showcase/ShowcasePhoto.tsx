const ShowcasePhoto = (props: { imgSrc: string }) => {
  console.log(props.imgSrc);

  return <img className="p-2" src={`/../${props.imgSrc}`} alt={props.imgSrc} />;
};

export default ShowcasePhoto;
