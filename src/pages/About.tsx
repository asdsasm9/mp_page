import AboutView from "../components/about/AboutView";
import usePageTitle from "../hooks/usePageTitle";
import "./../components/about/About.css";

const About = () => {
  usePageTitle("O mně");

  const aboutMe =
    "Jsem Terka a vítám Vás na své stránce. Již 5 let se věnuji fotografování. Nejdříve jsem se zaměřovala na fotografování přírody, která mě nikdy nepřestane fascinovat.\
    Ovšem velice brzy jsem si uvědomila, že mnohem zábavnější a dechberoucí je zachytit úžasné chvíle mezi lidmi.\
     Čas nejde zastavit, ale ve fotografii ho můžeme uchovat a kdykoliv se k ní vrátit a zavzpomínat.\
    Lidské příběhy mohou být stejně úchvatné jako zapadající slunce na pláži a nebo výhled na vrcholu hory. Pojďme spolu zachytit váš den a ty úžasné okamžiky v něm.\
    Věřím že naše spolupráce bude skvělý zážitek.";

  const experiencesDescription =
    "Za dobu mé kariéry jsem stihla vyfotit přes 46 000 fotek portrétů, 12 000 fotek svateb a 4 000 fotek produktů. \
    Absolvovala jsem kurz fotografování portrétů a nespočet kurzů na úpravu fotografií. \
    Fotografování byl pro mě odjakživa koníček, ale před pár lety jsem se rozhodla svoje dovednosti prohloubit na profesionální úrovni \
    a podstoupila jsem několika měsíční kurz, který mě pomohl najít mé vnímání fotografií. Díky tomuto kurzu, několikaletými zkušenostmi \
    a desítkami nafocených svateb vám mohu nabídnout tu největší kvalitu, kterou si Vaše momenty zaslouží.\
    Vždy se snažím zachytit lidi podle jejich představ a věřím, že správnou spoluprací lze dosáhnout skvělé výsledky.";

  const myStarts =
    "Fotografování mě zaujalo již v dětství. Nejenže jsem si tajně půjčovala tátův foťák a fotila květiny a včely na balkóně, ale také jsem milovala staré fotoalba. Vždy jsem mohla hodiny sedět s rodinnými fotografiemi a prohlížet si okamžiky, které jsme prožili. Na fotografiích se mi líbí to, že se k nim kdykoliv můžu vrátit a zavzpomínat, co jsem zažila. nebo skrz fotografie poznat mládí mých rodičů a to co oni zažívali. \
    Vždy mě bavilo se dívat kolem sebe a všímat si detailů, které mnoho lidem utekly. proto jsem se rozhodla je zachytit a tak zvěčnit ty jedinečné momenty plné emocí nebo i malých drobností v přírodě. \
    Jedna z mých oblíbených činností je chodit do přírody a dívat se kolem sebe. a čerpat tu jednoduchost a zároveň bohatství co se kolem nás skrývá. \
    ";

  return (
    <div className="w-full">
      <img
        className="w-full object-cover mainTopImg mb-10"
        src="fotky_web/site/about/main_about.jpg"
        alt=""
      />
      <AboutView
        title={"O MNĚ"}
        imgSrc={"fotky_web/site/about/nature.jpg"}
        description={aboutMe}
        textOnRight={true}
      ></AboutView>
      <AboutView
        title={"MÉ ZKUŠENOSTI"}
        imgSrc={"fotky_web/site/about/wedding.jpg"}
        description={experiencesDescription}
        textOnRight={false}
      ></AboutView>
      <AboutView
        title={"MŮJ PŘIBĚH"}
        imgSrc={"fotky_web/site/about/cake.jpg"}
        description={myStarts}
        textOnRight={true}
      ></AboutView>
    </div>
  );
};

export default About;
