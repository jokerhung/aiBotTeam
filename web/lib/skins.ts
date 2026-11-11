export interface Skin {
  id: string;
  name: string;
  tagline: string;
  dark: boolean;
}

export const SKINS: readonly Skin[] = [
  { id: "midnight", name: "Midnight", tagline: "The original. Cool and dark.", dark: true },
  { id: "atelier", name: "Atelier", tagline: "Daylight on paper, warm and quiet.", dark: false },
  { id: "foundry", name: "Foundry", tagline: "Night shift. Dark, warm, lit in brass.", dark: true },
  { id: "lagoon", name: "Lagoon", tagline: "Cool daylight. Porcelain and deep teal.", dark: false },
  { id: "graphite", name: "Graphite", tagline: "Quiet charcoal and softened steel blue.", dark: true },
  { id: "linen", name: "Linen", tagline: "Clean daylight with a restrained navy accent.", dark: false },
  { id: "dusk", name: "Dusk", tagline: "Muted plum after dark, calm and low-key.", dark: true },
  { id: "daylight", name: "Daylight", tagline: "Midnight in reverse. Near-white, ink-black bubbles.", dark: false },
  { id: "meadow", name: "Meadow", tagline: "Fresh white with a calm green.", dark: false },
  { id: "pop", name: "Pop", tagline: "Cream paper, thick ink outlines. Chunky and cheerful.", dark: false },
  { id: "halloween", name: "Halloween", tagline: "Plum after dark, lit in pumpkin orange.", dark: true },
  { id: "diwali", name: "Diwali", tagline: "Indigo night, lit in marigold and diya gold.", dark: true },
  { id: "aurora", name: "Aurora", tagline: "Near-black, crossed by a band of green light.", dark: true },
];

export const SKIN_IDS = new Set(SKINS.map((s) => s.id));

/** Apply the skin and the other look settings to <html> now, and remember them so the next load paints right away. */
export function applyLook(s: { skin: string; chatWidth: string; font: string; reduceMotion: boolean; language?: string }) {
  const d = document.documentElement;
  if (s.language) d.lang = s.language;
  const skin = SKIN_IDS.has(s.skin) ? s.skin : "daylight";
  d.dataset.skin = skin;
  if (s.chatWidth === "wide") d.dataset.chatWidth = "wide";
  else delete d.dataset.chatWidth;
  d.dataset.font = s.font;
  if (s.reduceMotion) d.dataset.reduceMotion = "";
  else delete d.dataset.reduceMotion;
  try {
    localStorage.setItem("botteam-skin", skin);
    if (s.chatWidth === "wide") localStorage.setItem("botteam-chat-width", "wide");
    else localStorage.removeItem("botteam-chat-width");
    localStorage.setItem("botteam-font", s.font);
    localStorage.setItem("botteam-reduce-motion", s.reduceMotion ? "1" : "");
  } catch { /* storage unavailable */ }
}
