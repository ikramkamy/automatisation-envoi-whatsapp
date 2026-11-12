/**
 * Comptes de l'équipe : fichier comptes.json (mots de passe hachés avec scrypt, jamais en clair)
 * et sessions en mémoire (un redémarrage du serveur déconnecte tout le monde).
 */
import fs from "fs";
import crypto from "crypto";

export const ROLES = ["lecteur", "operateur", "admin"];
const DUREE_SESSION_MS = 12 * 3600 * 1000;

export function hacher(motDePasse) {
  const sel = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(motDePasse, sel, 64).toString("hex");
  return `scrypt$${sel}$${h}`;
}

function verifierHash(motDePasse, stocke) {
  const [algo, sel, h] = String(stocke).split("$");
  if (algo !== "scrypt" || !sel || !h) return false;
  const calcule = crypto.scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(h, "hex");
  return attendu.length === calcule.length && crypto.timingSafeEqual(attendu, calcule);
}

export function creerComptes(fichier) {
  const lire = () => (fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, "utf8")) : []);
  const sessions = new Map();
  const echecs = new Map(); // anti-force brute : e-mail → { n, jusqua }

  return {
    lire,
    ajouter(email, nom, role, motDePasse) {
      if (!ROLES.includes(role)) throw new Error(`Rôle inconnu : ${role} (${ROLES.join(", ")})`);
      if (String(motDePasse).length < 10) throw new Error("Mot de passe trop court (10 caractères minimum)");
      const comptes = lire().filter((c) => c.email !== email.toLowerCase());
      comptes.push({ email: email.toLowerCase(), nom, role, hash: hacher(motDePasse), cree: new Date().toISOString() });
      fs.writeFileSync(fichier, JSON.stringify(comptes, null, 2));
    },
    connecter(email, motDePasse) {
      const cle = String(email || "").toLowerCase();
      const blocage = echecs.get(cle);
      if (blocage && blocage.jusqua > Date.now()) return { erreur: "Trop d'essais. Réessayez dans quelques minutes." };
      const compte = lire().find((c) => c.email === cle);
      // Le hachage est calculé même si le compte n'existe pas (temps de réponse identique).
      const ok = verifierHash(String(motDePasse || ""), compte?.hash || "scrypt$00$00") && !!compte;
      if (!ok) {
        const e = echecs.get(cle) || { n: 0, jusqua: 0 };
        e.n++;
        if (e.n >= 5) { e.jusqua = Date.now() + 10 * 60000; e.n = 0; }
        echecs.set(cle, e);
        return { erreur: "E-mail ou mot de passe incorrect." };
      }
      echecs.delete(cle);
      const jeton = crypto.randomBytes(32).toString("hex");
      sessions.set(jeton, { email: compte.email, nom: compte.nom, role: compte.role, expire: Date.now() + DUREE_SESSION_MS });
      return { jeton, utilisateur: { email: compte.email, nom: compte.nom, role: compte.role } };
    },
    session(jeton) {
      const s = jeton && sessions.get(jeton);
      if (!s) return null;
      if (s.expire < Date.now()) { sessions.delete(jeton); return null; }
      return s;
    },
    deconnecter(jeton) { sessions.delete(jeton); },
  };
}
