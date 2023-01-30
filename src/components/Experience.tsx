import ExperienceColumn from "./ExperienceColumn";

const ExperienceView = () => {
  const leftTitle = "PATI";
  const leftDescription =
    "S Terkou je focení vždy přirozené a zábavné. Dokáže zachytit ty nejlepší situace, takže z výsledků jsem vždy nadšená!";
  const leftImg = "fotky_web/reviews/experience1.jpeg";

  const rightTitle = "ANIČKA";
  const rightImg = "fotky_web/reviews/experience2.jpeg";
  const rightDescription =
    "Nejdříve jsme fotili spolu produktovky. Nakonec vznikly skvělé portréty, za které jsem moc vděčná";

  return (
    <>
      <p className="textHardTitle pl-10">Experiences</p>
      <div className="split-div mb-20">
        <ExperienceColumn
          imgSrc={leftImg}
          title={leftTitle}
          description={leftDescription}
        />
        <div className="line"></div>
        <ExperienceColumn
          imgSrc={rightImg}
          title={rightTitle}
          description={rightDescription}
        />
      </div>
    </>
  );
};

export default ExperienceView;
