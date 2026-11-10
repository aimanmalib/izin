import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { bootRuntime, createRuntime } from "./runtime.js";

const config = loadConfig();
const rt = createRuntime(config);
const { orphans } = await bootRuntime(rt, config);
const app = buildApp(config, rt);
if (orphans) app.log.warn({ orphans }, "checks left unfinished by the last run were marked as errors");
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      rt.db.close();
      process.exit(0);
    });
  });
}
