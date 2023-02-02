const HelloView = () => {
  const title = "Hello"; //title = "Vítejte";

  const description1 =
    "Having personally documented well over 300 weddings, I have been fortunate enough to document some of the most beautiful weddings all around the globe. I hope you take some time and visit my little corner on the internet, and learn more about how I can be part of your special day. I’m currently based in Los Angeles, but available worldwide where my camera might take me.";
  const description2 =
    "My work has been seen in all major US wedding publications; such as New York Times, Martha Stewart Weddings, The Knot, Wedding wire, Style Me Pretty and much more. I was also honored to be named Film Photographer of the year by Belle Lumiere Magazine.\
    Please take a look around the website, and I hope we connect soon!";
  return (
    <>
      <div className="md:flex">
        <div className="w-100 p-4 pl-20 py-10 md:w-1/2 ">
          <p className="textTitle w-100">{title}</p>
          <p className="textBasic md:mt-4 ">{description1}</p>
          <div className="spacer" />
          <p className="mt-4 textBasic">{description2}</p>
          <div className="py-3">
            <button className="learnMore">LEARN MORE</button>
          </div>
        </div>
        <div className="w-100 p-10 md:w-1/2 flex align-middle text-center">
          <img
            src="fotky_web/site/main/helllo.jpeg"
            alt="Image"
            className="helloViewImg"
          />
        </div>
      </div>
    </>
  );
};

export default HelloView;
