import express from "express";
import path from "node:path";

// The server only ships the app. Cards are encrypted and stored in the browser; nothing sensitive reaches it.
const port = Number(process.env.PORT ?? 8788);
// WALLET_BASE mounts the app under a path (WALLET_BASE=/Wallet for aj124.com/Wallet); empty serves at the root
const base = (process.env.WALLET_BASE ?? "").trim().replace(/\/+$/, "");
const staticDir = path.resolve(import.meta.dirname, "..", "web");

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; " +
      "form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  next();
});
app.use(
  express.static(staticDir, {
    setHeaders: (res, file) => {
      // hashed bundles never change; everything else (index.html, sw.js, manifest) is revalidated
      res.set("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    },
  }),
);

let server: express.Express = app;
if (base) {
  server = express();
  server.disable("x-powered-by");
  server.set("strict routing", true); // "/Wallet" redirects, "/Wallet/" serves
  server.get(base, (_req, res) => res.redirect(301, `${base}/`));
  server.use(base, app);
}
server.get("/healthz", (_req, res) => void res.type("text").send("ok"));

server.listen(port, () => {
  console.log(`[wallet] listening on http://localhost:${port}${base}/`);
});
