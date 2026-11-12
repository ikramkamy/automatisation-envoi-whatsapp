/**
 * Tests de l'interface de suivi : lecture du journal (format exact d'autosend.mjs), puis serveur
 * (connexion, lecture seule, aucun numéro complet ni secret dans les réponses).
 *   node test/tests.mjs
 */
import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { analyserJournal, analyserErreur, decoder, masquerTelephone, etatScript } from "../lib/journal.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
let echecs = 0;
const verifier = async (nom, f) => { try { await f(); console.log("  ✔ " + nom); } catch (e) { echecs++; console.log("  ✘ " + nom + "\n    " + e.message); } };

// Lignes produites par autosend.mjs (reprises de son code : log(), sendOne(), runOnce()).
const L = (h, m) => `[12/11/2026 ${h}] ${m}`;
const JOURNAL = [
  L("09:00:00", "3 enquête(s) en attente, 3 à traiter."),
  L("09:00:01", "OK  #101 Paolo Vera (593991234567)"),
  L("09:00:04", "ERR #102 (593991234568) : aucune config WhatsApp (wab) pour ECU/CORPMARESA/RAM "),
  L("09:00:07", `ERR #103 (593991234569) : WhatsApp n'a pas accepté le message (HTTP 400) : {"error":{"message":"(#131026) Message undeliverable","code":131026}}`),
  L("09:00:10", "Terminé : 1 envoyée(s), 2 erreur(s)."),
  L("09:00:10", "Mode boucle : prochaine vérification toutes les 5 min (Ctrl+C pour arrêter)."),
  L("09:05:00", "ERREUR GLOBALE : lecture API échouée (surveysingles 503, wabs 200)"),
  L("09:10:00", "MODE TEST : test/surveys.json + compte WhatsApp de test/wab.json (aucun appel à la prod)"),
  L("09:10:00", "1 enquête(s) en attente, 1 à traiter."),
  L("09:10:02", `ERR #900 (213600000000) : WhatsApp n'a pas accepté le message (HTTP 401) : {"error":{"code":190}}`),
  L("09:10:02", "Terminé : 0 envoyée(s), 1 erreur(s)."),
  L("09:15:00", "1 enquête(s) en attente, 1 à traiter."),
  L("09:15:00", "[DRY-RUN] #104 Ana Loor (593990000001) -> https://x.test/sending puis https://graph.test/messages (template pregunta_2)"),
  L("09:15:00", "Terminé : 1 simulée(s), 0 erreur(s)."),
  "ligne sans horodatage ignorée",
].join("\r\n");

console.log("Lecture du journal :");
const d = analyserJournal(JOURNAL);
await verifier("4 passages (dont 1 erreur globale)", () => assert.equal(d.passages.length, 4));
await verifier("envois : 1 OK, 3 erreurs, 1 simulation", () => {
  assert.equal(d.envois.filter((e) => e.statut === "ok").length, 1);
  assert.equal(d.envois.filter((e) => e.statut === "erreur").length, 3);
  assert.equal(d.envois.filter((e) => e.statut === "simule").length, 1);
});
await verifier("erreur de configuration reconnue (étape config)", () => assert.equal(d.envois.find((e) => e.id === 102).erreur.etape, "config"));
await verifier("refus Meta en mode normal = « marquée envoyée, non partie »", () => {
  const e = d.envois.find((x) => x.id === 103).erreur;
  assert.equal(e.etape, "meta"); assert.equal(e.fantome, true); assert.match(e.lisible, /n'a pas WhatsApp/);
});
await verifier("refus Meta en mode test : PAS marquée envoyée (FANS non appelé)", () => {
  const e = d.envois.find((x) => x.id === 900);
  assert.equal(e.mode, "test"); assert.equal(e.erreur.fantome, false); assert.match(e.erreur.lisible, /jeton/);
});
await verifier("passage en simulation étiqueté dry-run", () => assert.equal(d.passages.at(-1).mode, "dry-run"));
await verifier("erreur globale enregistrée", () => assert.equal(d.evenements.filter((e) => e.type === "erreur_globale").length, 1));
await verifier("mode boucle détecté (5 min)", () => assert.equal(d.modeBoucle.minutes, 5));
await verifier("aucun numéro complet conservé", () => assert.ok(!JSON.stringify(d).match(/\d{9,}/)));
await verifier("masquage : 593•••••4567", () => assert.equal(masquerTelephone("593991234567"), "593•••••4567"));
await verifier("seul le prénom et l'initiale sont gardés", () => { const e = d.envois[0]; assert.equal(e.prenom, "Paolo"); assert.equal(e.initiale, "V."); });
await verifier("journal UTF-16 (redirection PowerShell 5) lu correctement", () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JOURNAL, "utf16le")]);
  assert.equal(analyserJournal(decoder(buf)).envois.length, 5);
});
await verifier("erreur réseau reconnue", () => assert.equal(analyserErreur("fetch failed").etape, "reseau"));
await verifier("état : actif / en retard / silencieux selon la dernière activité", () => {
  const base = new Date(2026, 10, 12, 9, 15, 0);
  assert.equal(etatScript(d, new Date(base.getTime() + 2 * 60000)).niveau, "actif");
  assert.equal(etatScript(d, new Date(base.getTime() + 12 * 60000)).niveau, "retard");
  assert.equal(etatScript(d, new Date(base.getTime() + 20 * 60000)).niveau, "silencieux");
});

// ───── serveur ─────
console.log("Serveur :");
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "suivi-"));
fs.writeFileSync(path.join(dossier, "autosend.log"), JOURNAL);
fs.writeFileSync(path.join(dossier, "config.json"), JSON.stringify({ fichier_journal: "autosend.log", fichier_comptes: "comptes.json", port: 8791 }));
const env = { ...process.env, CONFIG: path.join(dossier, "config.json"), MAINTENANT: "2026-11-12T09:17:00" };
await new Promise((ok) => spawn(process.execPath, ["outils/creer-compte.mjs", "test@exemple.test", "Testeur", "lecteur"], { cwd: path.join(ICI, ".."), env: { ...env, MOT_DE_PASSE: "motdepasse-test-123" } }).on("close", ok));
const serveur = spawn(process.execPath, ["serveur.mjs"], { cwd: path.join(ICI, ".."), env });
await new Promise((r) => setTimeout(r, 800));
const B = "http://127.0.0.1:8791";
try {
  await verifier("comptes.json : mot de passe haché, jamais en clair", () => {
    const c = fs.readFileSync(path.join(dossier, "comptes.json"), "utf8");
    assert.ok(!c.includes("motdepasse-test-123")); assert.match(c, /scrypt\$/);
  });
  await verifier("sans connexion : API refusée (401) et page redirigée", async () => {
    assert.equal((await fetch(B + "/api/etat")).status, 401);
    assert.equal((await fetch(B + "/", { redirect: "manual" })).status, 302);
  });
  await verifier("mauvais mot de passe refusé", async () => {
    const r = await fetch(B + "/api/connexion", { method: "POST", body: JSON.stringify({ email: "test@exemple.test", motDePasse: "faux" }) });
    assert.equal(r.status, 401);
  });
  const r = await fetch(B + "/api/connexion", { method: "POST", body: JSON.stringify({ email: "test@exemple.test", motDePasse: "motdepasse-test-123" }) });
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  await verifier("connexion : cookie HttpOnly / SameSite=Strict", () => { assert.equal(r.status, 200); assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/); });
  const get = (u) => fetch(B + u, { headers: { cookie } }).then(async (x) => ({ status: x.status, corps: await x.text() }));
  const reponses = {};
  for (const u of ["/api/moi", "/api/etat", "/api/envois?jours=30", "/api/erreurs?jours=30", "/api/passages?jours=30", "/api/enquete/103"]) reponses[u] = await get(u);
  await verifier("toutes les routes répondent", () => { for (const [u, x] of Object.entries(reponses)) assert.equal(x.status, 200, u); });
  await verifier("état : script actif, 1 OK aujourd'hui, 1 « marquée envoyée non partie »", () => {
    const e = JSON.parse(reponses["/api/etat"].corps);
    assert.equal(e.etat.niveau, "actif"); assert.equal(e.jour.ok, 1); assert.equal(e.jour.fantomes, 1);
  });
  await verifier("erreurs regroupées par cause, « non parties » en premier", () => {
    const g = JSON.parse(reponses["/api/erreurs?jours=30"].corps).groupes;
    assert.equal(g[0].fantome, true); assert.equal(g.length, 3);
  });
  await verifier("aucun numéro complet dans les réponses de l'API", () => { for (const x of Object.values(reponses)) assert.ok(!x.corps.match(/\d{9,}/), x.corps.slice(0, 200)); });
  await verifier("aucun hash de mot de passe dans les réponses", () => { for (const x of Object.values(reponses)) assert.ok(!x.corps.includes("scrypt$")); });
  await verifier("lecture seule : toute écriture refusée (405)", async () => {
    assert.equal((await fetch(B + "/api/envois", { method: "POST", headers: { cookie } })).status, 405);
    assert.equal((await fetch(B + "/api/envois", { method: "DELETE", headers: { cookie } })).status, 405);
  });
  await verifier("pas d'accès aux fichiers hors du dossier public", async () => {
    for (const u of ["/statique/../serveur.mjs", "/statique/..%2Fconfig.exemple.json", "/statique/%2e%2e/lib/comptes.mjs"]) {
      const x = await get(u); assert.notEqual(x.status, 200, u);
    }
  });
  await verifier("déconnexion : la session ne marche plus", async () => {
    await fetch(B + "/api/deconnexion", { method: "POST", headers: { cookie } });
    assert.equal((await get("/api/etat")).status, 401);
  });
} finally {
  serveur.kill();
  fs.rmSync(dossier, { recursive: true, force: true });
}
console.log(echecs ? `\n${echecs} échec(s)` : "\nTous les tests de l'interface sont passés.");
process.exit(echecs ? 1 : 0);
