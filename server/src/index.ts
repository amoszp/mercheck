import "dotenv/config";
import express from "express";
import { join } from "node:path";
import { createRouter } from "./routes";
import { Store } from "./store";

const app = express();
const PORT = Number(process.env.PORT ?? 4480);
const FRONTEND_DIR = process.env.FRONTEND_DIR ?? join(__dirname, "../../dist");
const store = new Store(process.env.DB_PATH ?? "./data/mercheck.db");

app.disable("x-powered-by");
// The PWA only loads its own files: no third-party content, and it can't be
// framed by another site. Inline styles are allowed for the animation library.
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
      "manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "512kb" }));
app.use("/api", createRouter(store));
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not found" });
});

// The service worker and the page must always be fresh, or an update never lands.
app.use(
  express.static(FRONTEND_DIR, {
    setHeaders: (res, path) => {
      if (/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(path)) res.setHeader("Cache-Control", "no-cache");
    },
  })
);
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`[mercheck] listening on port ${PORT}`);
});
