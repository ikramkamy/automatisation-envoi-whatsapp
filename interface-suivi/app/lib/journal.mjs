/**
 * Lecture du journal d'autosend.mjs, SANS modifier le script.
 *
 * Le script écrit ses messages dans la console ; il suffit de les rediriger vers un fichier :
 *     node autosend.mjs >> autosend.log 2>&1
 * Ce module relit ce fichier et le transforme en passages / envois / erreurs.
 *
 * Lignes reconnues (format exact d'autosend.mjs) :
 *   [12/11/2026 09:30:00] MODE TEST : …
 *   [12/11/2026 09:30:00] 7 enquête(s) en attente, 5 à traiter.          → début d'un passage
 *   [12/11/2026 09:30:04] OK  #48213 Paolo Rossi (593991234567)            → envoi réussi
 *   [12/11/2026 09:30:08] ERR #48214 (593991234568) : message              → envoi en erreur
 *   [12/11/2026 09:30:09] [DRY-RUN] #48215 … -> …                          → simulation
 *   [12/11/2026 09:30:20] Terminé : 4 envoyée(s), 1 erreur(s).             → fin du passage
 *   [12/11/2026 09:30:00] ERREUR GLOBALE : …                               → passage impossible
 *   [12/11/2026 09:30:00] Passage précédent encore en cours, on saute.
 *   [12/11/2026 09:30:00] Mode boucle : prochaine vérification toutes les 5 min …
 */
import fs from "fs";

const RE_LIGNE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2}):(\d{2})\]\s?(.*)$/;

/** Numéro masqué : 593•••••4567 (jamais de numéro complet hors du serveur). */
export function masquerTelephone(t) {
  const n = String(t || "").replace(/\D/g, "");
  if (n.length < 7) return n ? "•••" : "";
  return n.slice(0, 3) + "•••••" + n.slice(-4);
}

/** Étape en échec et message lisible, à partir du message d'erreur du script. */
export function analyserErreur(message, modeTest) {
  const m = message || "";
  let etape = "inconnue", lisible = m, fantome = false, http = null;
  const code = m.match(/HTTP (\d{3})/);
  if (code) http = Number(code[1]);
  let r;
  if ((r = m.match(/aucune config WhatsApp \(wab\) pour (.*)$/))) {
    etape = "config";
    lisible = `Aucune configuration WhatsApp pour ${r[1].replace(/\//g, " / ")}`;
  } else if (/champ 'canal' manquant/.test(m)) {
    etape = "config";
    lisible = "Enquête sans canal (champ « canal » vide dans FANS)";
  } else if (/^\/sending a échoué/.test(m)) {
    etape = "bot_client";
    lisible = `Le bot du client a refusé l'enquête${http ? ` (HTTP ${http})` : ""}`;
  } else if (/^mise à jour sent_date échouée/.test(m)) {
    etape = "fans";
    lisible = `FANS n'a pas enregistré la date d'envoi${http ? ` (HTTP ${http})` : ""}`;
  } else if (/^WhatsApp n'a pas accepté le message/.test(m)) {
    etape = "meta";
    // En mode normal, la date d'envoi a déjà été écrite dans FANS avant l'appel à Meta.
    fantome = !modeTest;
    const meta = m.match(/"message":"([^"]+)"/);
    const codeMeta = m.match(/"code":(\d+)/);
    const raisons = { 131026: "le numéro n'a pas WhatsApp ou ne peut pas recevoir le message", 190: "jeton d'accès Meta invalide ou expiré", 132001: "modèle de message introuvable", 131047: "fenêtre de 24 h dépassée", 131056: "trop de messages vers ce numéro", 130429: "limite d'envoi Meta atteinte" };
    lisible = "Meta a refusé : " + (raisons[codeMeta?.[1]] || meta?.[1] || `HTTP ${http ?? "?"}`);
  } else if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket/i.test(m)) {
    etape = "reseau";
    lisible = "Serveur injoignable (réseau)";
  }
  return { etape, lisible, fantome, http, brut: m.slice(0, 2000) };
}

/** Décodage du fichier : UTF-8, ou UTF-16 (redirection « >> » de Windows PowerShell 5). */
export function decoder(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString("utf8");
  return buffer.toString("utf8");
}

/** Transforme le texte du journal en données structurées. */
export function analyserJournal(texte) {
  const passages = [];
  const envois = [];
  const evenements = []; // erreurs globales, sauts, démarrages
  let courant = null;
  let modeTest = false;
  let modeBoucle = null; // { date, minutes }
  let derniereLigne = null;
  let numero = 0;

  const ouvrir = (date, attente, aTraiter) => {
    courant = { id: ++numero, debut: date, fin: null, attente, aTraiter, ok: 0, ko: 0, simulees: 0, mode: modeTest ? "test" : "normal", termine: false };
    passages.push(courant);
  };

  for (const brute of texte.split(/\r?\n/)) {
    const l = brute.match(RE_LIGNE);
    if (!l) continue;
    const [, j, mo, a, h, mi, s, msg] = l;
    const date = new Date(Number(a), Number(mo) - 1, Number(j), Number(h), Number(mi), Number(s));
    derniereLigne = { date, message: msg };
    let r;

    if (/^MODE TEST/.test(msg)) { modeTest = true; continue; }
    if ((r = msg.match(/^(\d+) enquête\(s\) en attente, (\d+) à traiter\./))) { ouvrir(date, Number(r[1]), Number(r[2])); continue; }
    if ((r = msg.match(/^OK\s+#(\d+)\s+(.*?)\s*\(([^)]*)\)\s*$/))) {
      if (!courant) ouvrir(date, null, null);
      const [prenom, ...reste] = r[2].trim().split(/\s+/);
      envois.push({ id: Number(r[1]), date, passage: courant.id, statut: "ok", prenom: prenom || "", initiale: reste[0]?.[0] ? reste[0][0] + "." : "", telephone: masquerTelephone(r[3]), mode: courant.mode, erreur: null });
      courant.ok++;
      continue;
    }
    if ((r = msg.match(/^ERR\s+#(\d+)\s+\(([^)]*)\)\s*:\s*(.*)$/))) {
      if (!courant) ouvrir(date, null, null);
      envois.push({ id: Number(r[1]), date, passage: courant.id, statut: "erreur", prenom: "", initiale: "", telephone: masquerTelephone(r[2]), mode: courant.mode, erreur: analyserErreur(r[3], courant.mode === "test") });
      courant.ko++;
      continue;
    }
    if ((r = msg.match(/^\[DRY-RUN\]\s+#(\d+)\s+(.*?)\s*\(([^)]*)\)\s*->/))) {
      if (!courant) ouvrir(date, null, null);
      courant.mode = courant.mode === "test" ? "test" : "dry-run";
      const [prenom] = r[2].trim().split(/\s+/);
      envois.push({ id: Number(r[1]), date, passage: courant.id, statut: "simule", prenom: prenom || "", initiale: "", telephone: masquerTelephone(r[3]), mode: courant.mode, erreur: null });
      courant.simulees++;
      continue;
    }
    if ((r = msg.match(/^Terminé : (\d+) (envoyée|simulée)\(s\), (\d+) erreur\(s\)\./))) {
      if (courant) {
        courant.fin = date;
        courant.termine = true;
        if (r[2] === "simulée" && courant.mode === "normal") courant.mode = "dry-run";
      }
      courant = null;
      modeTest = false;
      continue;
    }
    if ((r = msg.match(/^ERREUR GLOBALE : (.*)$/))) {
      evenements.push({ date, type: "erreur_globale", message: r[1] });
      if (courant) { courant.fin = date; courant.erreurGlobale = r[1]; }
      else passages.push({ id: ++numero, debut: date, fin: date, attente: null, aTraiter: 0, ok: 0, ko: 0, simulees: 0, mode: modeTest ? "test" : "normal", termine: false, erreurGlobale: r[1] });
      courant = null;
      modeTest = false;
      continue;
    }
    if (/^Passage précédent encore en cours/.test(msg)) { evenements.push({ date, type: "saute", message: msg }); continue; }
    if ((r = msg.match(/^Mode boucle : prochaine vérification toutes les (\d+) min/))) { modeBoucle = { date, minutes: Number(r[1]) }; continue; }
  }
  return { passages, envois, evenements, modeBoucle, derniereLigne };
}

/** État du script à partir de la dernière activité connue. */
export function etatScript(donnees, maintenant, { intervalleMinutes = 5, retardMinutes = 10, silenceMinutes = 15 } = {}) {
  const dernier = donnees.passages.at(-1);
  const derniere = donnees.derniereLigne?.date;
  if (!derniere) return { niveau: "inconnu", libelle: "Aucune activité dans le journal" };
  const minutes = (maintenant - derniere) / 60000;
  const prochain = dernier ? new Date(dernier.debut.getTime() + intervalleMinutes * 60000) : null;
  let niveau = "actif", libelle = "Script actif";
  if (minutes > silenceMinutes) { niveau = "silencieux"; libelle = "Script silencieux"; }
  else if (minutes > retardMinutes) { niveau = "retard"; libelle = "Script en retard"; }
  if (niveau === "actif" && dernier?.erreurGlobale) { niveau = "retard"; libelle = "Dernier passage en erreur"; }
  return { niveau, libelle, derniereActivite: derniere, minutesDepuis: Math.round(minutes), dernierPassage: dernier || null, prochainPassage: prochain, modeBoucle: donnees.modeBoucle };
}

/** Lecture du fichier avec cache (relu seulement s'il a changé). */
export function creerLecteur(fichier) {
  let cache = null, cle = "";
  return () => {
    let stat;
    try { stat = fs.statSync(fichier); } catch { return { ...analyserJournal(""), absent: true }; }
    const nouvelleCle = `${stat.size}-${stat.mtimeMs}`;
    if (cache && cle === nouvelleCle) return cache;
    cache = analyserJournal(decoder(fs.readFileSync(fichier)));
    cache.fichierModifie = stat.mtime;
    cle = nouvelleCle;
    return cache;
  };
}
