import ContactView, { buttonInfo } from "../components/contact/ContactView";
import "./../components/contact/Contact.css";

const Contact = () => {
  const contactDesc =
    "Chcete nové fotky, nebo máte nejaké otázky? \
  Portréty, svatby, produkty, neváhejte se mi ozvat. Máte konkrétní představu o tom, jak by to mělo vypadat?\
  Výborně, tak ji můžeme zrealizovat. A když nemáte, vůbec nevadí! Společně se na všem domluvíme.  Napsat mi můžete na Instagram anebo na email. \
  Jako potvrzení vám odešlu potvrzovací email toho, na čem jsme se domluvili. Už se těším na naši spolupráci.";

  const instagramDesc =
    "Neváhejte se podívat i na můj Instagram.\
Pavidelne na něj přidávám nové příspěvky a novinky. \
Najdete tam i moje fotografie, které na stránce nejsou. \
Například fotografie přírody nebo zvířat. Pokud by vás něco zaujalo, můžete mě přes něj kontaktovat.";

  const buttonContact: buttonInfo = {
    title: "mullnyphotos@gmail.com",
    urlHref: "mailto: mullnyphotos@gmail.com",
  };
  const buttonInstagram: buttonInfo = {
    title: "@mullny_photos",
    urlHref: "https://www.instagram.com/mullny_photos/?hl=cs",
  };
  return (
    <>
      <div className="w-full">
        <img
          className="w-full object-cover contactMainImg mb-20"
          src="fotky_web/site/aboutExperience.jpeg"
          alt=""
        />
        <ContactView
          title={"KONTAKT"}
          imgSrc={"fotky_web/site/kontakt/kontakt.png"}
          description={contactDesc}
          textOnRight={false}
          button1={buttonContact}
        ></ContactView>

        <ContactView
          title={"INSTAGRAM"}
          imgSrc={"fotky_web/site/kontakt/instagram.png"}
          description={instagramDesc}
          textOnRight={true}
          button1={buttonInstagram}
        ></ContactView>
      </div>
    </>
  );
};

export default Contact;
