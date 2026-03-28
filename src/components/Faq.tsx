const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Was ist das hier?",
    answer:
      "Kleines Experiment; Idee von Rick, von mir geklaut und schnell gevibecodet, daher keine Garantie auf Richtigkeit. " +
      "Im Grunde wollen wir die Tierlist so objektiv wie möglich erstellen, damit sie nicht von persönlichen Vorlieben verzerrt wird. " +
      "Dazu werden immer zwei Pokémon zufällig ausgewählt und ihr müsst einfach nur entscheiden, welches in der TFL besser performed. " +
      "Wenn wir genug Results haben (siehe Progress Bar), sollte sich so langsam eine sinnvolle Tierlist bilden. Dann können wir mal schauen, ob das so Sinn ergibt oder wir noch ein bisschen nachjustieren müssen. " +
      "Die Tierlist wird von so nem fancy Elo-like-Algorithmus gebaut, den ich auch nicht so ganz verstehe. Aber besonders später wird immer versucht, dass man " +
      "zwei ähnlich performende Pokémon vergleicht, damit die Votes möglichst viel bringen. " +
      "Wir brauchen gut 9000 Votes, also votet gerne so viel wie ihr schafft!",
  },
  {
    question: "Da sind 2 Shitmons",
    answer:
      "Dann ist es nicht so wichtig. Sie werden eh beide im D landen, pick nach Gefühl.",
  },
  {
    question: "Habe mich verklickt",
    answer:
      "Pech, aber sollte nicht so schlimm sein, wenn wir genug Stimmen sammeln können. Aber bitte darauf achten, habe keine Lust, undo zu implementieren :D",
  },
  {
    question: "Glumanda im A???",
    answer:
      "Geduld. Am Anfang macht alles gar keinen Sinn. Erst wenn der Balken unten nicht mehr rot ist, formt sich langsam eine halbwegs sinnvolle Tierlist. Je mehr ihr votet, desto besser wird sie.",
  },
  {
    question: "Was heißt Fixed %, Std Dev und K-Means?",
    answer:
      "Das ist nur, um die Tiers einzuteilen. Da ich noch nicht weiß, wie das am Ende aussieht, wollte ich alle drei Strategien anbieten. Fixed % teilt die Pokémon basierend auf festen Prozentgrenzen ein (z.B. Top 5% in S, 15% in A usw.). Std Dev teilt die Pokémon basierend auf der Standardabweichung ihrer Scores ein. K-Means ist so ein Clustering-Algorithmus, der die Pokémon irgendwie anders in ihre Gruppen aufteilt. Klang irgendwie krass, deshalb dachte ich why not.",
  },
];

const FaqItem = ({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) => (
  <div className="border-t border-white/10 py-4 first:border-t-0">
    <dt className="text-sm font-medium text-white/50">{question}</dt>
    <dd className="mt-1 text-sm text-white/30">{answer}</dd>
  </div>
);

export const Faq = () => {
  if (FAQ_ITEMS.length === 0) return null;

  return (
    <section className="w-full max-w-xl">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/20">
        FAQ
      </h3>
      <dl>
        {FAQ_ITEMS.map((item) => (
          <FaqItem
            key={item.question}
            question={item.question}
            answer={item.answer}
          />
        ))}
      </dl>
    </section>
  );
};
