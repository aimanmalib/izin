// Header and footer shared by every page.
import { linkClick } from "../router";
import { useT } from "../i18n";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" className="logo-tile" />
      <rect x="27.5" y="27" width="9" height="25" rx="2.5" className="logo-stem" />
      <circle cx="32" cy="16.5" r="6" className="logo-dot" />
    </svg>
  );
}

export function Header() {
  const { t, lang, setLang } = useT();
  const other = lang === "en" ? "ms" : "en";
  return (
    <header className="hdr">
      <a className="skip" href="#main">{t.web.nav.skip}</a>
      <div className="wrap hdr-row">
        <a className="brand" href="/" onClick={linkClick} aria-label={t.web.nav.home}>
          <Logo />
          <span className="brand-name">{t.app.name}</span>
        </a>
        <nav className="hdr-nav" aria-label={t.app.name}>
          <a href="/gallery" className="hdr-link" onClick={linkClick}>{t.web.nav.gallery}</a>
          <a href="/docs" className="hdr-link" onClick={linkClick}>{t.web.nav.docs}</a>
          <button type="button" className="lang" lang={other} aria-label={t.web.nav.lang_label} onClick={() => setLang(other)}>
            {t.app.lang_toggle}
          </button>
        </nav>
      </div>
    </header>
  );
}

const FOOTER_PAGES = ["gallery", "bench", "trap", "docs", "bot"] as const;

export function Footer({ repoUrl }: { repoUrl: string | null }) {
  const { t } = useT();
  return (
    <footer className="ftr">
      <div className="wrap ftr-grid">
        <nav className="ftr-nav" aria-label={t.web.nav.pages}>
          {FOOTER_PAGES.map((p) => (
            <a key={p} href={`/${p}`} onClick={linkClick}>{t.web.nav[p]}</a>
          ))}
        </nav>
        <p className="ftr-notice">{t.web.footer.notice}</p>
        <p className="ftr-meta">
          {repoUrl ? <a href={repoUrl} rel="noopener">{t.web.footer.repo}</a> : null}
          <span>{t.web.footer.built}</span>
        </p>
      </div>
    </footer>
  );
}
