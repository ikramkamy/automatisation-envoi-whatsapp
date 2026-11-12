/**
 * Interface de suivi de l'envoi automatique WhatsApp (autosend.mjs) — v1 lecture seule.
 *
 *   node serveur.mjs                 (lit config.json à côté de ce fichier)
 *
 * Aucune dépendance npm (Node 18+). L'interface LIT le journal du script ; elle n'appelle
 * jamais FANS ni Meta et n'envoie aucun message.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { creerLecteur, etatScript } from "./lib/journal.mjs";
import { creerComptes } from "./lib/comptes.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FICHIER_CONFIG = process.env.CONFIG || path.join(ICI, "config.json");
if (!fs.existsSync(FICHIER_CONFIG)) {
  console.error(`Fichier de configuration introuvable : ${FICHIER_CONFIG}\nCopiez config.exemple.json en config.json et adaptez-le.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(FICHIER_CONFIG, "utf8"));
const resoudre = (p) => path.resolve(path.dirname(FICHIER_CONFIG), p);
const lireJournal = creerLecteur(resoudre(config.fichier_journal));
const comptes = creerComptes(resoudre(config.fichier_comptes || "comptes.json"));
const PUBLIC = path.join(ICI, "public");
const COOKIE = "suivi_session";
const maintenant = () => (process.env.MAINTENANT ? new Date(process.env.MAINTENANT) : new Date());

// ───── petits outils HTTP ─────
const json = (res, code, donnees) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(donnees));
};
const lireCookie = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((c) => c[0]))[COOKIE];
const lireCorps = (req) => new Promise((ok, ko) => {
  let corps = "";
  req.on("data", (c) => { corps += c; if (corps.length > 10000) { ko(new Error("trop gros")); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(corps || "{}")); } catch { ok({}); } });
});
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const ENTETES_SECURITE = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:",
};

function servirFichier(res, nom) {
  const fichier = path.join(PUBLIC, path.normalize(nom).replace(/^(\.\.[\/\\])+/, ""));
  if (!fichier.startsWith(PUBLIC) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) { res.writeHead(404); return res.end("Introuvable"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] || "application/octet-stream", "Cache-Control": "no-cache", ...ENTETES_SECURITE });
  fs.createReadStream(fichier).pipe(res);
}

// ───── API (lecture seule) ─────
function apiEtat() {
  const d = lireJournal();
  const etat = etatScript(d, maintenant(), config.seuils || {});
  const debutJour = new Date(maintenant()); debutJour.setHours(0, 0, 0, 0);
  const jour = d.envois.filter((e) => e.date >= debutJour && e.mode === "normal");
  const depuis24h = new Date(maintenant().getTime() - 24 * 3600000);
  const heures = [];
  for (let i = 23; i >= 0; i--) {
    const fin = new Date(maintenant()); fin.setMinutes(0, 0, 0); fin.setHours(fin.getHours() - i + 1);
    const debut = new Date(fin.getTime() - 3600000);
    const dans = d.envois.filter((e) => e.date >= debut && e.date < fin && e.mode === "normal");
    heures.push({ debut, ok: dans.filter((e) => e.statut === "ok").length, ko: dans.filter((e) => e.statut === "erreur").length });
  }
  return {
    journalAbsent: !!d.absent,
    etat,
    jour: {
      ok: jour.filter((e) => e.statut === "ok").length,
      ko: jour.filter((e) => e.statut === "erreur").length,
      fantomes: jour.filter((e) => e.erreur?.fantome).length,
    },
    fantomes24h: d.envois.filter((e) => e.erreur?.fantome && e.date >= depuis24h).length,
    heures,
    dernieresErreurs: d.envois.filter((e) => e.statut === "erreur").slice(-6).reverse(),
    erreursGlobales: d.evenements.filter((e) => e.type === "erreur_globale").slice(-3).reverse(),
  };
}

function periode(url) {
  const jours = Number(url.searchParams.get("jours")) || 1;
  return new Date(maintenant().getTime() - jours * 24 * 3600000);
}

function apiEnvois(url) {
  const d = lireJournal();
  const depuis = periode(url);
  const statut = url.searchParams.get("statut") || "";
  const texte = (url.searchParams.get("q") || "").trim();
  const liste = d.envois.filter((e) => e.date >= depuis &&
    (!statut || (statut === "fantome" ? e.erreur?.fantome : e.statut === statut)) &&
    (!texte || String(e.id).includes(texte) || e.telephone.endsWith(texte.replace(/\D/g, "").slice(-4)) && texte.replace(/\D/g, "").length >= 4));
  return { total: liste.length, envois: liste.slice(-500).reverse() };
}

function apiErreurs(url) {
  const d = lireJournal();
  const depuis = periode(url);
  const groupes = {};
  for (const e of d.envois.filter((x) => x.statut === "erreur" && x.date >= depuis)) {
    const g = (groupes[e.erreur.lisible] ||= { lisible: e.erreur.lisible, etape: e.erreur.etape, fantome: e.erreur.fantome, http: e.erreur.http, envois: [] });
    g.envois.push({ id: e.id, date: e.date });
  }
  const liste = Object.values(groupes).map((g) => ({ ...g, nombre: g.envois.length, derniere: g.envois.at(-1).date, envois: g.envois.slice(-20).reverse() }))
    .sort((a, b) => b.fantome - a.fantome || b.nombre - a.nombre);
  return { groupes: liste, erreursGlobales: d.evenements.filter((e) => e.type === "erreur_globale" && e.date >= depuis).reverse() };
}

function apiPassages(url) {
  const d = lireJournal();
  const depuis = periode(url);
  return { passages: d.passages.filter((p) => p.debut >= depuis).slice(-500).reverse() };
}

function apiEnquete(id) {
  const d = lireJournal();
  const tentatives = d.envois.filter((e) => e.id === Number(id)).reverse();
  return tentatives.length ? { id: Number(id), tentatives } : null;
}

// ───── routeur ─────
const serveur = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const jeton = lireCookie(req);
    const utilisateur = comptes.session(jeton);

    if (url.pathname === "/api/connexion" && req.method === "POST") {
      const { email, motDePasse } = await lireCorps(req);
      const r = comptes.connecter(email, motDePasse);
      if (r.erreur) return json(res, 401, { erreur: r.erreur });
      res.setHeader("Set-Cookie", `${COOKIE}=${r.jeton}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.cookie_securise ? "; Secure" : ""}`);
      return json(res, 200, { utilisateur: r.utilisateur });
    }
    if (url.pathname === "/api/deconnexion" && req.method === "POST") {
      comptes.deconnecter(jeton);
      res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, 200, {});
    }
    if (url.pathname === "/connexion" || url.pathname === "/connexion.html") return servirFichier(res, "connexion.html");
    if (url.pathname.startsWith("/statique/")) return servirFichier(res, url.pathname.slice("/statique/".length));

    if (!utilisateur) {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { erreur: "Non connecté" });
      res.writeHead(302, { Location: "/connexion" });
      return res.end();
    }

    if (req.method !== "GET") return json(res, 405, { erreur: "Lecture seule (v1)" });
    if (url.pathname === "/api/moi") return json(res, 200, { email: utilisateur.email, nom: utilisateur.nom, role: utilisateur.role });
    if (url.pathname === "/api/etat") return json(res, 200, apiEtat());
    if (url.pathname === "/api/envois") return json(res, 200, apiEnvois(url));
    if (url.pathname === "/api/erreurs") return json(res, 200, apiErreurs(url));
    if (url.pathname === "/api/passages") return json(res, 200, apiPassages(url));
    if (url.pathname.startsWith("/api/enquete/")) {
      const r = apiEnquete(url.pathname.split("/").pop());
      return r ? json(res, 200, r) : json(res, 404, { erreur: "Enquête absente du journal" });
    }
    // v2 : les actions (pause, relance…) arriveront ici, réservées au rôle « operateur ».
    if (url.pathname === "/" || url.pathname === "/index.html") return servirFichier(res, "index.html");
    res.writeHead(404); res.end("Introuvable");
  } catch (e) {
    console.error("Erreur :", e.message);
    if (!res.headersSent) json(res, 500, { erreur: "Erreur interne" });
  }
});

const PORT = Number(process.env.PORT || config.port || 8780);
const HOTE = config.hote || "127.0.0.1";
serveur.listen(PORT, HOTE, () => {
  console.log(`Interface de suivi : http://${HOTE === "0.0.0.0" ? "localhost" : HOTE}:${PORT}  (journal : ${resoudre(config.fichier_journal)})`);
  if (!comptes.lire().length) console.log("⚠ Aucun compte : créez-en un avec  node outils/creer-compte.mjs");
});
