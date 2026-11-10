import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSite, type SiteView } from "./api";
import { Footer, Header } from "./components/Chrome";
import { initialLang, LANGS, LangContext, saveLang, type Lang } from "./i18n";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { ReceiptPage } from "./pages/Receipt";
import { usePath } from "./router";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/home.css";
import "./styles/receipt.css";

function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [site, setSite] = useState<SiteView | null>(null);
  const [siteFailed, setSiteFailed] = useState(false);
  const path = usePath();
  const t = LANGS[lang];
  const ctx = useMemo(() => ({ lang, t, setLang: (l: Lang) => (saveLang(l), setLangState(l)) }), [lang, t]);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (path === "/") document.title = t.web.meta.title;
  }, [lang, t, path]);

  useEffect(() => {
    void getSite().then((s) => (s ? setSite(s) : setSiteFailed(true))).catch(() => setSiteFailed(true));
  }, []);

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [path, site]);

  const receipt = /^\/r\/([a-z2-7]{8,32})$/.exec(path);
  let body;
  if (!site) body = siteFailed ? <p className="wrap problem" role="alert">{t.web.errors.network}</p> : <div className="wrap loading" aria-busy="true" />;
  else if (path === "/") body = <Home site={site} />;
  else if (receipt) body = <ReceiptPage id={receipt[1]!} pollMs={site.poll_ms} stepMs={site.step_ms} />;
  else body = <NotFound />;

  return (
    <LangContext.Provider value={ctx}>
      <Header />
      <main id="main" tabIndex={-1}>{body}</main>
      <Footer repoUrl={site?.repo_url ?? null} />
    </LangContext.Provider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
