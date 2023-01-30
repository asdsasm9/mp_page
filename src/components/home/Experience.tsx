import ExperienceColumn from "./ExperienceColumn";

const ExperienceView = () => {
  const absoluteTopTitle = "EXPERIENCES";
  const leftName = "Lauren & Jesse";
  const leftPlace = "CHARLESTON, SC";
  const leftDescription =
    "S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!. S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!";
  const leftImg = "fotky_web/por";

  const rightName = "Rameez & Laurel";
  const rightPlace = "NAPA, CA";
  const rightImg = "fotky_web/reviews/experience2.jpeg";
  const rightDescription =
    "Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná. Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná. Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná";

  return (
    <>
      <div className="flex pb-20 pt-20">
        <ExperienceColumn
          imgSrc={leftImg}
          name={leftName}
          place={leftPlace}
          description={leftDescription}
          absoluteTopTitle={absoluteTopTitle}
        />
        <div className="line"></div>
        <ExperienceColumn
          imgSrc={rightImg}
          name={rightName}
          place={rightPlace}
          description={rightDescription}
          absoluteTopTitle={""}
        />
      </div>
    </>
  );
};

export default ExperienceView;
