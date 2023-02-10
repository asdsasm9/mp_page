import AboutView from "../components/about/AboutView";
import "./../components/about/About.css";

const About = () => {
  const aboutMe =
    "Jsem Terka a vítám Vás na své stránce. Již 5 let se věnuji fotografování. Nejdříve jsem se zaměřovala na fotografování přírody, která mě nikdy nepřestane fascinovat.\
    Ovšem velice brzy jsem si uvědomila, že mnohem zábavnější a dechberoucí je zachytit úžasné chvíle mezi lidmi.\
     Čas nejde zastavit, ale ve fotografii ho můžeme uchovat a kdykoliv se k ní vrátit a zavzpomínat.\
    Lidské příběhy mohou být stejně úchvatné jako zapadající slunce na pláži a nebo výhled na vrcholu hory. Pojďme spolu zachytit váš den a ty úžasné okamžiky v něm.\
    Věřím že naše spolupráce bude skvělý zážitek.";

  const experiencesDescription =
    "Fotím již 5 let. Za tu dobu jsem stihla vyfotit 46 000 fotek portrétů, 12 000 fotek svateb a 4 000 fotek produktů. \
    Absolvovala jsem kurz fotografování portrétů a nespočet kurzů na úpravu fotografií. \
    V budoucnu bych se chtěla věnovat i dalším zaměřením a rozšířit si zkušenosti ve fotografii. \
    Vždy se snažím zachytit lidi podle jejich představ a věřím, že správnou spoluprací lze dosáhnout skvělé výsledky.";

  const myGear =
    "V mém fotobatohu se skrývá několik úžasných spolupracovníků, bez kterých by to nešlo. \
    Důležité jsou samozřejmě bohaté zkušenosti, ale i vybavení se kterým fotograf fotí. Tímto vybavením vám zajišťuji kvalitu fotografií, které se budou vyjímat ve vašem fotoalbu. \
    Fotím se Sony Alpha A7R III s objektivem Sigma 24-70 mm f/2,8 DG DN Art. Taky vlastním Nikon D 7100 a objektivy Nikon 50 mm f/1,8 AF-S NIKKOR G nebo Sigma 17-50 mm f/2,8 EX DC OS HSM.\
    Součastí vybavení jsou taky stativy, průhledné deštníky, fotoodrazky, externí blesk a mnoho dalšího. ";

  return (
    <div className="w-full">
      <img
        className="w-full object-cover aboutMainImg mb-10"
        src="fotky_web/site/about/main_about.jpg"
        alt=""
      />
      <AboutView
        title={"O MNĚ"}
        imgSrc={"fotky_web/site/o_mne/o_mne.png"}
        description={aboutMe}
        textOnRight={true}
      ></AboutView>
      <AboutView
        title={"MOJE ZKUŠENOSTI"}
        imgSrc={"fotky_web/site/o_mne/moje_skusenosti.png"}
        description={experiencesDescription}
        textOnRight={false}
      ></AboutView>

      <AboutView
        title={"MOJE VYBAVENÍ"}
        imgSrc={"fotky_web/site/o_mne/vybavenie.png"}
        description={myGear}
        textOnRight={true}
      ></AboutView>
    </div>
  );
};

export default About;
