import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LANGS, type Lang } from "./i18n";

function App() {
  const [lang, setLang] = useState<Lang>("en");
  const t = LANGS[lang];
  return (
    <main lang={lang}>
      <h1>{t.app.name}</h1>
      <p>{t.app.tagline}</p>
      <button type="button" onClick={() => setLang(lang === "en" ? "ms" : "en")}>
        {t.app.lang_toggle}
      </button>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
