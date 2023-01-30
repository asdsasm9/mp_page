import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const NavMenu = () => {
  const navigate = useNavigate();
  const [backgroundColor, setBackgroundColor] = useState("transparent");

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        setBackgroundColor("white");
      } else {
        setBackgroundColor("transparent");
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div
      className="w-full top-0 left-0 fixed flex items-center justify-between p-2 bg-white"
      style={{
        transition: "background-color 0.3s ease-in-out",
        backgroundColor,
      }}
    >
      <div className="text-lg font-bold px-20">
        <button className="logoFont" onClick={() => navigate("/")}>
          MULLNY
        </button>
      </div>
      <div className="flex space-x-20 px-20">
        <button className="navText" onClick={() => navigate("/")}>
          Home
        </button>
        <button className="navText" onClick={() => navigate("/portfolio")}>
          Portfolio
        </button>
        <button className="navText" onClick={() => navigate("/about")}>
          About
        </button>
        <button className="navText" onClick={() => navigate("/contact")}>
          Contact
        </button>
      </div>
    </div>
  );
};

export default NavMenu;
