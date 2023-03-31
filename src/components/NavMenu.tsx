import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./NavMenu.css";

const NavMenu = () => {
  const navigate = useNavigate();
  const [backgroundColor, setBackgroundColor] = useState("transparent");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleBackground = () => {
    if (window.scrollY > 0 || isMenuOpen) {
      setBackgroundColor("#fAfAfA");
    } else {
      setBackgroundColor("transparent");
    }
  };

  const handleClick = (url: string) => {
    navigate(url);
    setIsMenuOpen(false);
  };

  const changeMenuOpen = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  useEffect(() => {
    window.addEventListener("scroll", handleBackground);
    handleBackground();
    return () => {
      window.removeEventListener("scroll", handleBackground);
    };
  }, [isMenuOpen]);

  let dropDownButtons = (
    <>
      <button
        className="navDropdownText dropdown-content-button"
        onClick={() => handleClick("/weddings")}
      >
        - Svadby
      </button>
      <button
        className="navDropdownText dropdown-content-button"
        onClick={() => handleClick("/portraits")}
      >
        - Portréty
      </button>
      <button
        className="navDropdownText dropdown-content-button"
        onClick={() => handleClick("/couples")}
      >
        - Párové focení
      </button>
    </>
  );

  let portfolioDropDown = (
    <li className="dropdown">
      <button className="navText" onClick={() => handleClick("/portfolio")}>
        Portfolio
      </button>
      <div className="dropdown-content">{dropDownButtons}</div>
    </li>
  );

  let menuButton = (
    <button
      className={`sm:hidden text-white navText`}
      onClick={() => changeMenuOpen()}
    >
      <svg
        className={`h-6 w-6 fill-current ${isMenuOpen ? "hidden" : ""}`}
        viewBox="0 0 24 24"
        style={{ color: "black" }}
      >
        <path d="M4 5h16a1 1 0 0 1 0 2H4a1 1 0 1 1 0-2zm0 6h16a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2zm0 6h16a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2z" />
      </svg>
      <svg
        className={`fill-current h-6 w-6 ${!isMenuOpen ? "hidden" : ""}`}
        viewBox="0 0 24 24"
        style={{ color: "black" }}
      >
        <path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z" />
      </svg>
    </button>
  );

  return (
    <>
      <header
        className="fixed top-0 w-full  text-white"
        style={{
          transition: "background-color 0.2s ease-in-out",
          backgroundColor,
        }}
      >
        <div className=" px-4 py-3 sm:flex items-center justify-between md:mx-10">
          <div className="flex w-100 justify-between">
            <div className="text-lg font-bold ">
              <button
                className="mainLogo logoFont"
                onClick={() => handleClick("/home")}
              >
                <img src="/fotky_web/site/common/main_logo_2.png" />
              </button>
            </div>
            {menuButton}
          </div>
          <nav className={``}>
            <ul
              className={`list-reset  justify-between block sm:flex text-center ${
                isMenuOpen ? "" : "hidden"
              }`}
            >
              <li>
                <button
                  className="navText"
                  onClick={() => handleClick("/home")}
                >
                  Úvod
                </button>
              </li>
              {portfolioDropDown}
              <li>
                <button
                  className="navText"
                  onClick={() => handleClick("/about")}
                >
                  O mně
                </button>
              </li>
              <li>
                <button
                  className="navText"
                  onClick={() => handleClick("/contact")}
                >
                  Kontakt
                </button>
              </li>
            </ul>
          </nav>
        </div>
      </header>
    </>
  );
};

export default NavMenu;
