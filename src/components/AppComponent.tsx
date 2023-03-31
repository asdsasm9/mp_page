import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Category } from "../data/Data";
import About from "../pages/About";
import Contact from "../pages/Contact";
import Home from "../pages/Home";
import PhotosShowcase from "../pages/PhotosShowcase";
import Portfolio from "../pages/Portfolio";
import Weddings from "../pages/Weddings";
import BottomBar from "./BottomBar";
import NavMenu from "./NavMenu";
import ScrollToTop from "./ScrollToTop";

const AppComponent = () => {
  return (
    <>
      <HashRouter>
        <ScrollToTop></ScrollToTop>
        <NavMenu></NavMenu>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/weddings" element={<Weddings />} />
          <Route
            path="/weddings/:wedding_id"
            element={<PhotosShowcase category={Category.WEDDING} />}
          />
          <Route
            path="/portraits"
            element={<PhotosShowcase category={Category.PORTRAITS} />}
          />
          <Route
            path="/couples"
            element={<PhotosShowcase category={Category.COUPLES} />}
          />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/*" element={<Navigate to="/home" />} />
        </Routes>

        <BottomBar></BottomBar>
      </HashRouter>
    </>
  );
};

export default AppComponent;
