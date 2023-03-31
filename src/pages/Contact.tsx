import ContactView, { buttonInfo } from "../components/contact/ContactView";
import { InstagramUrl, MailUrl } from "../data/Translations";
import usePageTitle from "../hooks/usePageTitle";
import "./../components/contact/Contact.css";

const Contact = () => {
  usePageTitle("Kontakt");

  const contactDesc =
    "Pokud máte zájem o nové fotografie nebo máte nějaké dotazy ohledně portrétů, svateb nebo produktů, neváhejte mě kontaktovat.\
     Máte konkrétní představu, jak by měly fotografie vypadat? Skvěle, společně to dokážeme zrealizovat. \
     Pokud ale žádné nápady zatím nemáte, nevadí! Můžeme společně vymyslet něco skvělého. \
     Kontaktovat mě můžete přes Instagram nebo e-mail. Jakmile se dohodneme na všech podrobnostech, zašlu vám potvrzovací e-mail.\
    Už se těším na naši spolupráci!";

  const instagramDesc =
    "Neváhejte se podívat i na můj Instagram. Pavidelne na něj přidávám nové příspěvky a novinky. \
    Najdete tam i moje fotografie, které na stránce nejsou. Například fotografie přírody nebo zvířat. \
    Pokud by vás něco zaujalo, můžete mě přes něj kontaktovat.";

  const buttonContact: buttonInfo = {
    title: "mullnyphotos@gmail.com",
    urlHref: MailUrl,
  };
  const buttonInstagram: buttonInfo = {
    title: "@mullny_photos",
    urlHref: InstagramUrl,
  };
  return (
    <>
      <div className="w-full">
        <img
          className="w-full mb-14 object-cover mainTopImg"
          src="fotky_web/site/contact/main_contact.jpg"
          alt=""
        />
        <ContactView
          title={"KONTAKT"}
          imgSrc={"fotky_web/site/contact/contact.jpg"}
          description={contactDesc}
          textOnRight={false}
          button1={buttonContact}
        ></ContactView>

        <ContactView
          title={"INSTAGRAM"}
          imgSrc={"fotky_web/site/contact/instagram.png"}
          description={instagramDesc}
          textOnRight={true}
          button1={buttonInstagram}
        ></ContactView>
      </div>
    </>
  );
};

export default Contact;
