/**
 * Fabrique un faux journal au format EXACT d'autosend.mjs (données inventées), pour essayer l'interface.
 *
 *   node outils/generer-journal-demo.mjs demo/autosend.log [--fin 2026-11-12T09:32:00]
 */
import fs from "fs";
import path from "path";

const sortie = process.argv[2] || "demo/autosend.log";
const iFin = process.argv.indexOf("--fin");
const FIN = iFin > 0 ? new Date(process.argv[iFin + 1]) : new Date();

let graine = 11;
const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
const choisir = (t) => t[Math.floor(alea() * t.length)];
const horodatage = (d) => `[${d.toLocaleString("fr-FR")}]`;
const PRENOMS = ["Paolo Vera", "María Loor", "Luis Andrade", "Ana Pazmiño", "Jorge Rivas", "Carla Mena", "Diego Salas", "Sofía Ortiz"];
const INDICATIFS = ["593", "593", "593", "591", "56"];
const tel = () => { const i = choisir(INDICATIFS); return i + String(Math.floor(alea() * 1e9)).padStart(9, "0").slice(0, i === "56" ? 9 : 9); };

const ERREURS = [
  () => "aucune config WhatsApp (wab) pour ECU/CORPMARESA/RAM ",
  () => `WhatsApp n'a pas accepté le message (HTTP 400) : {"error":{"message":"(#131026) Message undeliverable","type":"OAuthException","code":131026,"fbtrace_id":"AbC123"}}`,
  () => `/sending a échoué (HTTP 502) : "Bad Gateway"`,
  () => "mise à jour sent_date échouée (HTTP 500)",
  () => "fetch failed",
];

const lignes = [];
let id = 48100;
const debut = new Date(FIN.getTime() - 26 * 3600000);
let t = new Date(debut);
let premier = true;
while (t < FIN) {
  const h = t.getHours();
  const actif = h >= 7 && h <= 20;
  // une coupure de 40 min la nuit (PC en veille) pour montrer les trous
  if (h === 2 && t.getMinutes() < 40) { t = new Date(t.getTime() + 5 * 60000); continue; }
  if (alea() < 0.01) {
    lignes.push(`${horodatage(t)} ERREUR GLOBALE : lecture API échouée (surveysingles 503, wabs 200)`);
  } else {
    const n = actif ? Math.floor(alea() * 5) : alea() < 0.1 ? 1 : 0;
    const attente = n + Math.floor(alea() * 2);
    const dry = alea() < 0.01;
    lignes.push(`${horodatage(t)} ${attente} enquête(s) en attente, ${n} à traiter.`);
    let ok = 0, ko = 0, u = new Date(t.getTime() + 800);
    for (let k = 0; k < n; k++) {
      const nom = choisir(PRENOMS), numero = tel();
      if (dry) {
        lignes.push(`${horodatage(u)} [DRY-RUN] #${id} ${nom} (${numero}) -> https://bot.exemple.test/sending puis https://graph.facebook.com/v23.0/000/messages (template pregunta_1)`);
        ok++;
      } else if (alea() < 0.12) {
        const err = alea() < 0.45 ? ERREURS[0]() : choisir(ERREURS.slice(1))();
        lignes.push(`${horodatage(u)} ERR #${id} (${numero}) : ${err}`);
        ko++;
      } else {
        lignes.push(`${horodatage(u)} OK  #${id} ${nom} (${numero})`);
        ok++;
      }
      id++;
      u = new Date(u.getTime() + 3000 + alea() * 1500);
    }
    lignes.push(`${horodatage(u)} Terminé : ${ok} ${dry ? "simulée(s)" : "envoyée(s)"}, ${ko} erreur(s).`);
    if (premier) { lignes.push(`${horodatage(u)} Mode boucle : prochaine vérification toutes les 5 min (Ctrl+C pour arrêter).`); premier = false; }
  }
  t = new Date(t.getTime() + 5 * 60000);
}
fs.mkdirSync(path.dirname(path.resolve(sortie)), { recursive: true });
fs.writeFileSync(sortie, lignes.join("\n") + "\n");
console.log(`${lignes.length} lignes écrites dans ${sortie} (jusqu'au ${FIN.toLocaleString("fr-FR")}).`);
