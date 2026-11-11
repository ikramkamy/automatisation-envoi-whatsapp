/**
 * Envoi automatique des enquêtes WhatsApp.
 *
 * Reproduit exactement ce que fait le bouton WhatsApp de surveysingles.html
 * (méthode sendsurveysingle), mais pour toutes les enquêtes "En attente",
 * sans intervention manuelle.
 *
 * Usage :
 *   node autosend.mjs                 -> tourne en boucle (toutes les INTERVAL_MINUTES)
 *   node autosend.mjs --once          -> un seul passage puis s'arrête (pratique pour le Planificateur de tâches)
 *   node autosend.mjs --dry-run       -> affiche ce qui serait envoyé, sans rien envoyer
 *   node autosend.mjs --once --limit=5 -> un passage, 5 envois maximum
 *   node autosend.mjs --test --once   -> MODE TEST : enquêtes lues dans test/surveys.json,
 *                                        compte WhatsApp de test lu dans test/wab.json,
 *                                        ni /sending ni l'API de production ne sont appelés
 *                                        (sent_date est écrit dans test/surveys.json)
 *   node autosend.mjs --test --once --reset -> idem, en effaçant d'abord les sent_date (pour renvoyer)
 *
 * Nécessite Node 18+ (fetch natif), aucune dépendance npm.
 */

import fs from "fs";

const API_URL = "https://api-fans-stellantis.breedgital.com:4080/api";
const API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

const INTERVAL_MINUTES = 5; // fréquence de vérification en mode boucle
const DELAY_BETWEEN_SENDS_MS = 3000; // pause entre deux envois (évite le blocage par Meta)

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const DRY_RUN = args.includes("--dry-run");
const TEST = args.includes("--test");
const RESET = TEST && args.includes("--reset"); // test uniquement : renvoie les enquêtes déjà envoyées
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity;

const TEST_SURVEYS_FILE = new URL("./test/surveys.json", import.meta.url);
const TEST_WAB_FILE = new URL("./test/wab.json", import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(`[${new Date().toLocaleString("fr-FR")}]`, ...m);

async function http(method, url, body, token) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

// Mode test : le compte WhatsApp de test remplace la config wab de l'API
function loadTestWab() {
  const t = readJson(TEST_WAB_FILE);
  if (!t.phone_number_id || !t.token_messages || [t.phone_number_id, t.token_messages].includes("A_REMPLIR")) {
    throw new Error("test/wab.json : renseignez phone_number_id et token_messages du compte WhatsApp de test");
  }
  return {
    brand_message: t.brand_message || "",
    url_messages: `https://graph.facebook.com/${t.graph_version || "v23.0"}/${t.phone_number_id}/messages`,
    token_messages: t.token_messages,
  };
}

// Mode test : sent_date est enregistré dans le fichier local au lieu de l'API
function markSentLocally(id, sent_date) {
  const surveys = readJson(TEST_SURVEYS_FILE);
  const s = surveys.find((x) => x.id === id);
  if (s) s.sent_date = sent_date;
  fs.writeFileSync(TEST_SURVEYS_FILE, JSON.stringify(surveys, null, 2));
}

function getWab(wabs, customer) {
  if (TEST) return wabs[0];
  return wabs.find(
    (item) =>
      item.country === customer.pays &&
      item.importator === customer.importator &&
      item.brand === customer.brand
  );
}

function generateFirstJson(s) {
  return {
    phone: s.customer.phone,
    client: `${s.customer.first_name}`,
    brand: s.customer.brand,
    email: s.customer.email,
    survey: s.survey,
    id: s.id,
    customer: s.customer,
    surveysingle: s,
  };
}

function generateSecondJson(s, brand_message) {
  return {
    messaging_product: s.canal.toLowerCase(),
    to: s.customer.phone,
    type: "template",
    template: {
      name: "pregunta_" + s.survey,
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: s.customer.first_name },
            {
              type: "text",
              text:
                s.customer.pays === "CHL"
                  ? `${brand_message} - ${s.customer.dealer}`
                  : `${brand_message}`,
            },
          ],
        },
      ],
    },
  };
}

async function sendOne(s, wabs) {
  const label = `#${s.id} ${s.customer?.first_name ?? ""} ${s.customer?.last_name ?? ""} (${s.customer?.phone})`;

  const wab = getWab(wabs, s.customer || {});
  if (!wab) throw new Error(`aucune config WhatsApp (wab) pour ${s.customer?.pays}/${s.customer?.importator}/${s.customer?.brand}`);
  if (!s.canal) throw new Error("champ 'canal' manquant");

  const brand_message = wab.brand_message || "";
  const url_script = (wab.url_script || "").trim();
  const url_messages = (wab.url_messages || "").trim();
  const token_messages = wab.token_messages || "";

  const first_message = generateFirstJson(s);
  const second_message = generateSecondJson(s, brand_message);

  if (DRY_RUN) {
    log(`[DRY-RUN] ${label} -> ${TEST ? "(/sending ignoré)" : url_script} puis ${url_messages} (template ${second_message.template.name})`);
    if (TEST) log("[DRY-RUN] message :", JSON.stringify(second_message));
    return;
  }

  const sent_date = new Date().toISOString();
  if (!TEST) {
    // 1) Initialise la conversation côté serveur (servernexum.js /sending)
    const sending = await http("POST", url_script, first_message, token_messages);
    if (sending.data?.message != 200) {
      throw new Error(`/sending a échoué (HTTP ${sending.status}) : ${JSON.stringify(sending.data)}`);
    }

    // 2) Marque l'enquête comme envoyée dans l'API (comme le bouton)
    const updated = { ...s, sent_date };
    const put = await http("PUT", `${API_URL}/surveysingles/${s.id}`, updated);
    if (put.status !== 200) {
      throw new Error(`mise à jour sent_date échouée (HTTP ${put.status})`);
    }
  }

  // 3) Envoie le template WhatsApp
  const whatsapp = await http("POST", url_messages, second_message, token_messages);
  const status = whatsapp.data?.messages?.[0]?.message_status;
  if (status !== "accepted") {
    throw new Error(`WhatsApp n'a pas accepté le message (HTTP ${whatsapp.status}) : ${JSON.stringify(whatsapp.data)}`);
  }
  if (TEST) markSentLocally(s.id, sent_date);

  log(`OK  ${label}`);
}

let running = false;

async function runOnce() {
  if (running) return log("Passage précédent encore en cours, on saute.");
  running = true;
  try {
    let surveys, wabs;
    if (TEST) {
      log("MODE TEST : test/surveys.json + compte WhatsApp de test/wab.json (aucun appel à la prod)");
      surveys = readJson(TEST_SURVEYS_FILE);
      if (RESET) {
        surveys.forEach((x) => delete x.sent_date);
        fs.writeFileSync(TEST_SURVEYS_FILE, JSON.stringify(surveys, null, 2));
        log("--reset : sent_date effacé dans test/surveys.json");
      }
      wabs = [loadTestWab()];
    } else {
      const auth = API_TOKEN;
      const [surveysRes, wabsRes] = await Promise.all([
        http("GET", `${API_URL}/surveysingles`, null, auth),
        http("GET", `${API_URL}/wabs`, null, auth),
      ]);
      if (surveysRes.status !== 200 || wabsRes.status !== 200) {
        throw new Error(`lecture API échouée (surveysingles ${surveysRes.status}, wabs ${wabsRes.status})`);
      }
      surveys = surveysRes.data || [];
      wabs = wabsRes.data || [];
    }

    const pending = surveys.filter((item) => item.sent_date == undefined && !item.is_old);
    const todo = pending.slice(0, LIMIT);
    log(`${pending.length} enquête(s) en attente, ${todo.length} à traiter.`);

    let ok = 0;
    let ko = 0;
    for (const s of todo) {
      try {
        await sendOne(s, wabs);
        ok++;
      } catch (e) {
        ko++;
        log(`ERR #${s.id} (${s.customer?.phone}) : ${e.message}`);
      }
      if (!DRY_RUN) await sleep(DELAY_BETWEEN_SENDS_MS);
    }
    log(`Terminé : ${ok} ${DRY_RUN ? "simulée(s)" : "envoyée(s)"}, ${ko} erreur(s).`);
  } catch (e) {
    log(`ERREUR GLOBALE : ${e.message}`);
  } finally {
    running = false;
  }
}

await runOnce();
if (!ONCE && !DRY_RUN) {
  log(`Mode boucle : prochaine vérification toutes les ${INTERVAL_MINUTES} min (Ctrl+C pour arrêter).`);
  setInterval(runOnce, INTERVAL_MINUTES * 60 * 1000);
}
