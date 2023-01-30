import { BrowserRouter, Route, Routes } from "react-router-dom";
import About from "../pages/About";
import Contact from "../pages/Contact";
import Home from "../pages/Home";
import NotFound from "../pages/NotFound";
import Portforlio from "../pages/Portfolio";
import BottomBar from "./BottomBar";
import NavMenu from "./NavMenu";

const AppComponent = () => {
  return (
    <>
      <BrowserRouter>
        <NavMenu></NavMenu>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/portfolio" element={<Portforlio />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/*" element={<NotFound />} />
        </Routes>

        <BottomBar></BottomBar>
      </BrowserRouter>
    </>
  );
};

export default AppComponent;
