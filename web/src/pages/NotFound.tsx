import { useT } from "../i18n";
import { linkClick } from "../router";

export function NotFound() {
  const { t } = useT();
  return (
    <section className="section">
      <div className="wrap narrow">
        <h1>{t.web.errors.not_found_head}</h1>
        <p>{t.web.errors.not_found}</p>
        <p><a href="/" onClick={linkClick}>{t.web.errors.back_home}</a></p>
      </div>
    </section>
  );
}
