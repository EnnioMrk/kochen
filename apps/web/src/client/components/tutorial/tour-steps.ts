/**
 * The tour. Each step points at one element through `data-tour`. A step
 * without a target shows a card in the middle. A target that is not on the
 * screen (a desktop-only control on a phone) falls back to the middle card.
 */
export type TourStep = {
  /** Value of the `data-tour` attribute to point at. */
  target?: string;
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Willkommen bei Kochen",
    body:
      "Kochen sammelt deine Rezepte an einem Ort. Die Tour zeigt dir die wichtigsten Stellen in einer Minute. Du kannst sie jederzeit überspringen.",
  },
  {
    target: "capture",
    title: "Rezept erfassen",
    body:
      "Hier startest du einen Import. Füge einen Link ein, lade Fotos hoch oder sprich den Text ein. Die KI baut daraus ein Rezept mit Zutaten und Schritten.",
  },
  {
    target: "recipes",
    title: "Deine Rezepte",
    body:
      "Hier liegen deine Rezepte und deine Varianten. Tippe ein Rezept an, um es zu öffnen, zu kochen oder zu bearbeiten.",
  },
  {
    target: "discover",
    title: "Entdecken",
    body:
      "Hier siehst du Rezepte von Freunden und anderen Mitgliedern. Übernimm ein Rezept als eigene Variante.",
  },
  {
    target: "search",
    title: "Suche",
    body:
      "Suche nach Name, Zutat oder Tag. Die Suche findet auch Rezepte, die du lange nicht offen hattest.",
  },
  {
    target: "shopping",
    title: "Einkauf",
    body:
      "Zutaten aus einem Rezept landen auf deiner Einkaufsliste. Hake sie im Laden ab, die Liste bleibt für alle Geräte gleich.",
  },
  {
    target: "friends",
    title: "Freunde",
    body:
      "Lade Freunde ein und teile Rezepte. Ihr könnt Varianten voneinander übernehmen und kommentieren.",
  },
  {
    target: "profile",
    title: "Profil und Einstellungen",
    body:
      "Unter Einstellungen startest du diese Tour erneut, wählst die Kochansicht und verwaltest Benachrichtigungen.",
  },
  {
    title: "Viel Spaß beim Kochen",
    body: "Das war die Tour. Du kannst sie unter Einstellungen jederzeit wiederholen.",
  },
];
