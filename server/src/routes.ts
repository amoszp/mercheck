import { Router, type NextFunction, type Request, type Response } from "express";
import {
  AccountsUnavailable,
  clearSessionCookie,
  clientInfo,
  forgetToken,
  login,
  logout,
  readToken,
  requireUser,
  setSessionCookie,
  signup,
  type User,
  verify,
} from "./auth";
import * as siri from "./siri";
import * as voice from "./voice";
import { OpError, type Store } from "./store";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    // Through then() so a synchronous throw is caught as well.
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof AccountsUnavailable) {
          res.status(503).json({ error: "accounts service unavailable" });
          return;
        }
        if (err instanceof OpError) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      });

export function createRouter(store: Store): Router {
  const router = Router();

  // ---------- session ----------

  router.post(
    "/auth/login",
    wrap(async (req, res) => {
      const { username, password } = req.body ?? {};
      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        res.status(400).json({ error: "username and password are required" });
        return;
      }
      if (username.length > 64 || password.length > 256) {
        res.status(401).json({ error: "wrong username or password" });
        return;
      }
      const { status, data } = await login(username, password, clientInfo(req));
      if (status !== 200) {
        res.status(status === 429 ? 429 : 401).json({ error: status === 429 ? "too many attempts" : "wrong username or password" });
        return;
      }
      setSessionCookie(res, data.token);
      res.json({ user: data.user });
    })
  );

  router.post(
    "/auth/signup",
    wrap(async (req, res) => {
      const { username, password, displayName } = req.body ?? {};
      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        res.status(400).json({ error: "username and password are required" });
        return;
      }
      if (username.length > 64 || password.length > 256 || (typeof displayName === "string" && displayName.length > 80)) {
        res.status(400).json({ error: "too long" });
        return;
      }
      const { status, data } = await signup(username, password, typeof displayName === "string" ? displayName : "", clientInfo(req));
      if (status === 201) {
        // New accounts work at once: sign the user straight in.
        setSessionCookie(res, data.token);
        res.status(201).json({ user: data.user });
        return;
      }
      const code = status === 429 ? 429 : status === 409 ? 409 : 400;
      res.status(code).json({ error: code === 429 ? "too many sign-ups" : code === 409 ? "username taken" : data?.message ?? "invalid" });
    })
  );

  router.post(
    "/auth/logout",
    wrap(async (req, res) => {
      const token = readToken(req);
      if (token) {
        forgetToken(token);
        await logout(token);
      }
      clearSessionCookie(res);
      res.status(204).send();
    })
  );

  // ---------- voice (minimal iPhone Shortcut: plain text in, plain text out) ----------
  // GET so the shortcut needs nothing but a web address; the API key comes as
  // ?key= and every answer is a sentence for Siri to read, errors included.

  const voiceRoute = (handle: (user: User, text: string) => string) =>
    async (req: Request, res: Response, next: NextFunction) => {
      res.set("Cache-Control", "no-store").type("text/plain; charset=utf-8");
      const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
      try {
        const user = key ? await verify(key) : null;
        if (!user) {
          res.status(401).send("No reconozco la clave de este atajo.");
          return;
        }
        res.send(handle(user, voice.queryText(req.query.text)));
      } catch (err) {
        if (err instanceof AccountsUnavailable) {
          res.status(503).send("Mercheck no puede comprobar tu clave ahora mismo. Prueba en un rato.");
          return;
        }
        if (err instanceof OpError) {
          res.status(400).send("Eso ya no existe en tus listas. No he cambiado nada.");
          return;
        }
        next(err);
      }
    };

  router.get("/siri/say", voiceRoute((user, text) => voice.say(store, user.id, text)));
  router.get("/siri/answer", voiceRoute((user, text) => voice.answer(store, user.id, text)));

  router.use(requireUser());

  router.get("/auth/me", (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  // ---------- lists ----------

  router.get("/state", (req: Request, res: Response) => {
    res.json(store.getState(req.user!.id));
  });

  // One change from the app; answers with the full state so the app can't drift.
  router.post(
    "/ops",
    wrap((req, res) => {
      store.apply(req.user!.id, req.body);
      res.json(store.getState(req.user!.id));
    })
  );

  // Lists kept in the browser before accounts, copied once into an empty account.
  router.post(
    "/import",
    wrap((req, res) => {
      const imported = store.importState(req.user!.id, req.body);
      res.json({ imported, state: store.getState(req.user!.id) });
    })
  );

  // ---------- Siri (iPhone Shortcuts, API key in Authorization: Bearer) ----------

  router.post(
    "/siri/lookup",
    wrap((req, res) => {
      const text = req.body?.text;
      if (typeof text !== "string" || !text.trim() || text.length > 300) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      res.json(siri.lookup(store, req.user!.id, text));
    })
  );

  router.post(
    "/siri/apply",
    wrap((req, res) => {
      res.json(siri.apply(store, req.user!.id, req.body?.option));
    })
  );

  return router;
}
