import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Category } from "../data/Data";
import About from "../pages/About";
import Contact from "../pages/Contact";
import Home from "../pages/Home";
import NotFound from "../pages/NotFound";
import PhotosShowcase from "../pages/PhotosShowcase";
import Weddings from "../pages/Weddings";
import BottomBar from "./BottomBar";
import NavMenu from "./NavMenu";
import ScrollToTop from "./ScrollToTop";

const AppComponent = () => {
  return (
    <>
      <BrowserRouter basename="/mp_page">
        <ScrollToTop></ScrollToTop>
        <NavMenu></NavMenu>
        <Routes>
          <Route path="/home" element={<Home />} />
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
          <Route path="/*" element={<NotFound />} />
        </Routes>

        <BottomBar></BottomBar>
      </BrowserRouter>
    </>
  );
};

export default AppComponent;
