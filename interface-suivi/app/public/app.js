/* Interface de suivi — v1 lecture seule. Toutes les données viennent de /api (journal d'autosend.mjs). */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const D = (s) => (s ? new Date(s) : null);
const fmtH = (d) => (d ? D(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDH = (d) => (d ? D(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + fmtH(d) : "—");
const ETAPES = { config: "Configuration", bot_client: "Bot du client", fans: "FANS", meta: "Meta", reseau: "Réseau", inconnue: "Inconnue" };
const CONSEILS = {
  config: "Vérifier pays / importateur / marque de l'enquête dans FANS, ou ajouter la configuration WhatsApp correspondante (attention aux espaces et majuscules).",
  bot_client: "Vérifier que le bot du client tourne (pm2) et répond sur /sending.",
  fans: "Vérifier l'API FANS.",
  meta: "Vérifier le numéro du client, le modèle de message ou le jeton Meta du compte.",
  reseau: "Vérifier la connexion Internet de la machine du script et l'adresse appelée.",
  inconnue: "Voir la réponse brute.",
};
let moi = null;
let minuterie = null;
const filtres = { jours: "1", statut: "", q: "" };

async function api(chemin) {
  const r = await fetch(chemin, { headers: { Accept: "application/json" } });
  if (r.status === 401) { location.href = "/connexion"; throw new Error("non connecté"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erreur || `HTTP ${r.status}`);
  return r.json();
}

const boutonV2 = (libelle) => `<button class="btn btn-v2" disabled title="Prévu en v2 (rôle Opérateur)">${libelle}</button>`;
function badgeStatut(e) {
  if (e.statut === "ok") return '<span class="badge b-ok">✓ Envoyée</span>';
  if (e.statut === "simule") return '<span class="badge b-mode">Simulation</span>';
  if (e.erreur?.fantome) return '<span class="badge b-fantome">⚠ Marquée envoyée, non partie</span>';
  return '<span class="badge b-ko">✕ Erreur</span>';
}
const badgeMode = (m) => (m && m !== "normal" ? ` <span class="badge b-mode">${esc(m)}</span>` : "");
const client = (e) => esc([e.prenom, e.initiale].filter(Boolean).join(" ")) || '<span class="muted">—</span>';

// ───────────── Tableau de bord ─────────────
async function pageTableau() {
  const d = await api("/api/etat");
  derniereEtat = d;
  const e = d.etat;
  const dp = e.dernierPassage;
  if (d.journalAbsent) return `<h1>Tableau de bord</h1><div class="bandeau crit">Le fichier journal du script est introuvable. Vérifiez <b>fichier_journal</b> dans config.json et que le script est bien lancé avec sa sortie redirigée (voir LISEZMOI).</div>`;
  return `
  <h1>Tableau de bord <small class="maj">· mis à jour à ${fmtH(new Date())}, actualisation automatique</small></h1>
  ${d.erreursGlobales.length && (new Date() - D(d.erreursGlobales[0].date)) < 3600e3 ? `<div class="bandeau crit">⚠ <b>Erreur globale à ${fmtH(d.erreursGlobales[0].date)}</b> : ${esc(d.erreursGlobales[0].message)}</div>` : ""}
  <div class="carte etat mb">
    <span class="pastille p-${e.niveau}">${esc(e.libelle)}</span>
    <dl>
      <div><dt>Dernière activité</dt><dd>${e.derniereActivite ? `il y a ${e.minutesDepuis} min (${fmtDH(e.derniereActivite)})` : "—"}</dd></div>
      <div><dt>Dernier passage</dt><dd>${dp ? `${fmtH(dp.debut)} · ${dp.ok + dp.ko + dp.simulees} traitée(s)${badgeMode(dp.mode)}` : "—"}</dd></div>
      <div><dt>Prochain passage prévu</dt><dd>${!e.modeBoucle ? "selon le Planificateur" : D(e.prochainPassage) < new Date() ? `${fmtH(e.prochainPassage)} <span style="color:var(--warn-ink)">(attendu)</span>` : fmtH(e.prochainPassage)}</dd></div>
      <div><dt>Fonctionnement</dt><dd>${e.modeBoucle ? `en boucle, toutes les ${e.modeBoucle.minutes} min` : "un passage par lancement"}</dd></div>
    </dl>
    <span style="margin-left:auto">${boutonV2("⏸ Mettre en pause")}</span>
  </div>
  <div class="grille g4 mb">
    <div class="carte tuile"><div class="lib">En attente dans FANS</div><div class="val">${dp?.attente ?? "—"}</div><div class="sous">au dernier passage</div></div>
    <div class="carte tuile"><div class="lib">Envoyées aujourd'hui</div><div class="val">${d.jour.ok}</div><div class="sous">depuis minuit</div></div>
    <div class="carte tuile"><div class="lib">Erreurs aujourd'hui</div><div class="val">${d.jour.ko}</div><div class="sous"><a href="#/erreurs">voir les causes</a></div></div>
    <div class="carte tuile ${d.fantomes24h ? "alerte" : ""}"><div class="lib">⚠ Marquées envoyées, non parties</div><div class="val">${d.fantomes24h}</div><div class="sous">24 h · FANS les croit envoyées : elles ne seront pas retentées</div></div>
  </div>
  <div class="grille g2">
    <div class="carte">
      <h2>Envois par heure — 24 dernières heures</h2>
      <div class="legende"><span><i style="background:var(--series-ok)"></i>Envoyées</span><span><i style="background:var(--critical)"></i>⚠ Erreurs</span>
        <a class="bascule" id="basculeTable">Voir en tableau</a></div>
      <div id="graphique"></div>
    </div>
    <div class="carte">
      <h2>Dernières erreurs</h2>
      ${d.dernieresErreurs.length ? d.dernieresErreurs.map((x) => `
        <div class="erreur-mini" data-lien="#/enquete/${x.id}">
          <div style="display:flex; justify-content:space-between; gap:8px"><b>#${x.id}</b><span class="muted">${fmtDH(x.date)}</span></div>
          <div>${esc(x.erreur.lisible)}</div>
          <div class="muted" style="font-size:12px">étape ${ETAPES[x.erreur.etape]} · ${esc(x.telephone)}</div>
        </div>`).join("") : '<div class="vide">Aucune erreur 🎉</div>'}
    </div>
  </div>`;
}

function dessinerGraphique(heures) {
  const zone = $("#graphique");
  if (!zone) return;
  if (zone.dataset.vue === "table") {
    zone.innerHTML = `<table><thead><tr><th>Heure</th><th class="num">Envoyées</th><th class="num">Erreurs</th></tr></thead><tbody>${heures.map((h) => `<tr><td>${fmtH(h.debut)}</td><td class="num">${h.ok}</td><td class="num">${h.ko}</td></tr>`).join("")}</tbody></table>`;
    return;
  }
  const W = Math.max(320, zone.clientWidth), H = 220, m = { g: 32, d: 8, h: 8, b: 24 };
  const max = Math.max(4, ...heures.map((h) => h.ok + h.ko));
  const pas = Math.ceil(max / 4), yMax = pas * 4;
  const lw = (W - m.g - m.d) / heures.length, bw = Math.max(4, lw - 4);
  const y = (v) => m.h + (H - m.h - m.b) * (1 - v / yMax);
  const barre = (x, yh, w, h, arrondi) => {
    if (h <= 0) return "";
    const r = arrondi ? Math.min(4, w / 2, h) : 0;
    return `M${x},${yh + h} V${yh + r} Q${x},${yh} ${x + r},${yh} H${x + w - r} Q${x + w},${yh} ${x + w},${yh + r} V${yh + h} Z`;
  };
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Envois et erreurs par heure sur 24 heures">`;
  for (let v = 0; v <= yMax; v += pas) s += `<line x1="${m.g}" x2="${W - m.d}" y1="${y(v)}" y2="${y(v)}" stroke="var(${v ? "--grid" : "--axis"})"/><text x="${m.g - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  heures.forEach((h, i) => {
    const x = m.g + i * lw + (lw - bw) / 2, yOk = y(h.ok), yKo = y(h.ok + h.ko);
    if (h.ok) s += `<path d="${barre(x, yOk, bw, y(0) - yOk, !h.ko)}" fill="var(--series-ok)"/>`;
    if (h.ko) s += `<path d="${barre(x, yKo, bw, yOk - yKo - (h.ok ? 2 : 0), true)}" fill="var(--critical)"/>`;
    if (i % 3 === 0) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${D(h.debut).getHours()}h</text>`;
    s += `<rect x="${m.g + i * lw}" y="${m.h}" width="${lw}" height="${H - m.h - m.b}" fill="transparent" data-i="${i}"/>`;
  });
  zone.innerHTML = s + "</svg>";
  const bulle = $("#bulle");
  zone.querySelectorAll("rect[data-i]").forEach((r) => {
    r.addEventListener("mousemove", (ev) => {
      const h = heures[r.dataset.i];
      bulle.innerHTML = `<b>${fmtH(h.debut)} – ${fmtH(D(h.debut).getTime() + 3600000)}</b><br>Envoyées : ${h.ok}<br>⚠ Erreurs : ${h.ko}`;
      bulle.style.display = "block"; bulle.style.left = ev.clientX + 12 + "px"; bulle.style.top = ev.clientY + 12 + "px";
      r.setAttribute("fill", "rgba(127,127,127,.08)");
    });
    r.addEventListener("mouseleave", () => { bulle.style.display = "none"; r.setAttribute("fill", "transparent"); });
  });
}

// ───────────── Envois ─────────────
const selectPeriode = () => `<select data-f="jours">${[["1", "24 dernières heures"], ["7", "7 derniers jours"], ["30", "30 derniers jours"], ["90", "90 derniers jours"]].map(([v, l]) => `<option value="${v}" ${filtres.jours === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;

async function pageEnvois() {
  const p = new URLSearchParams({ jours: filtres.jours, statut: filtres.statut, q: filtres.q });
  const d = await api("/api/envois?" + p);
  const opt = (v, l) => `<option value="${v}" ${filtres.statut === v ? "selected" : ""}>${l}</option>`;
  return `
  <h1>Envois</h1>
  <div class="carte">
    <div class="filtres">
      ${selectPeriode()}
      <select data-f="statut">${opt("", "Tous les statuts")}${opt("ok", "Envoyées")}${opt("erreur", "En erreur")}${opt("fantome", "Marquées envoyées, non parties")}${opt("simule", "Simulations")}</select>
      <input class="plein" data-f="q" placeholder="N° d'enquête ou 4 derniers chiffres du téléphone…" value="${esc(filtres.q)}">
      <button class="btn" id="exportCsv">⬇ Export CSV</button>
    </div>
    <div class="muted" style="margin-bottom:8px">${d.total} enquête(s)${d.total > d.envois.length ? ` · ${d.envois.length} plus récentes affichées` : ""}</div>
    ${d.envois.length ? `<table><thead><tr><th>Date</th><th>Enquête</th><th>Client</th><th>Téléphone</th><th>Statut</th><th>Étape</th><th>Détail</th></tr></thead>
    <tbody>${d.envois.map((e) => `<tr data-lien="#/enquete/${e.id}">
      <td>${fmtDH(e.date)}</td><td>#${e.id}${badgeMode(e.mode)}</td><td>${client(e)}</td><td class="muted">${esc(e.telephone)}</td>
      <td>${badgeStatut(e)}</td><td>${e.erreur ? `<span class="badge b-etape">${ETAPES[e.erreur.etape]}</span>` : ""}</td>
      <td class="muted detail" title="${esc(e.erreur?.lisible || "")}">${e.erreur ? esc(e.erreur.lisible) : e.statut === "ok" ? "Accepté par Meta" : "Rien envoyé (simulation)"}</td></tr>`).join("")}</tbody></table>`
    : '<div class="vide">Aucune enquête pour ces filtres.</div>'}
  </div>`;
}

async function exporterCsv() {
  const d = await api("/api/envois?" + new URLSearchParams({ jours: filtres.jours, statut: filtres.statut, q: filtres.q }));
  const lignes = [["date", "enquete", "statut", "telephone_masque", "etape", "detail", "mode"]].concat(
    d.envois.map((e) => [D(e.date).toISOString(), e.id, e.erreur?.fantome ? "marquee_envoyee_non_partie" : e.statut, e.telephone, e.erreur?.etape || "", e.erreur?.lisible || "", e.mode]));
  const csv = lignes.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `envois-whatsapp-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ───────────── Erreurs ─────────────
async function pageErreurs() {
  const d = await api("/api/erreurs?jours=" + filtres.jours);
  const fantomes = d.groupes.filter((g) => g.fantome).reduce((n, g) => n + g.nombre, 0);
  return `
  <h1>Erreurs <small>· regroupées par cause</small></h1>
  <div class="filtres">${selectPeriode()}</div>
  ${fantomes ? `<div class="bandeau crit"><b>⚠ ${fantomes} enquête(s) marquées « envoyées » dans FANS mais jamais parties.</b>
    Le script a noté la date d'envoi dans FANS avant que Meta ne refuse le message : elles ne seront pas retentées automatiquement.
    <a data-filtre-fantome>Voir la liste</a></div>` : ""}
  ${d.erreursGlobales.length ? `<div class="bandeau warn"><b>${d.erreursGlobales.length} passage(s) impossible(s)</b> (erreur globale), dernier à ${fmtDH(d.erreursGlobales[0].date)} : ${esc(d.erreursGlobales[0].message)}</div>` : ""}
  <div class="carte">
    ${d.groupes.length ? d.groupes.map((g) => `<div class="cause">
      <div class="nb">${g.nombre}</div>
      <div style="flex:1; min-width:0">
        <div><b>${esc(g.lisible)}</b> ${g.fantome ? '<span class="badge b-fantome">⚠ marquées envoyées</span>' : ""}</div>
        <div class="muted">Étape : <span class="badge b-etape">${ETAPES[g.etape]}</span>${g.http ? " · HTTP " + g.http : ""} · dernière le ${fmtDH(g.derniere)}</div>
        <div style="margin-top:4px">💡 ${CONSEILS[g.etape]}</div>
        <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap">${g.envois.map((e) => `<a href="#/enquete/${e.id}">#${e.id}</a>`).join("")}${g.nombre > g.envois.length ? " …" : ""}</div>
      </div>
      <div>${boutonV2("↻ Relancer")}</div>
    </div>`).join("") : '<div class="vide">Aucune erreur sur cette période 🎉</div>'}
  </div>`;
}

// ───────────── Passages ─────────────
async function pagePassages() {
  const d = await api("/api/passages?jours=" + filtres.jours);
  return `
  <h1>Passages du script</h1>
  <div class="filtres">${selectPeriode()}</div>
  <div class="carte">
    ${d.passages.length ? `<table><thead><tr><th>Début</th><th>Mode</th><th class="num">En attente</th><th class="num">Traitées</th><th class="num">Envoyées</th><th class="num">Erreurs</th><th class="num">Durée</th><th>Remarque</th></tr></thead>
    <tbody>${d.passages.map((p) => `<tr>
      <td>${fmtDH(p.debut)}</td><td>${p.mode === "normal" ? "normal" : `<span class="badge b-mode">${esc(p.mode)}</span>`}</td>
      <td class="num">${p.attente ?? "—"}</td><td class="num">${p.ok + p.ko + p.simulees}</td><td class="num">${p.mode === "normal" ? p.ok : `${p.ok + p.simulees}*`}</td>
      <td class="num" style="${p.ko ? "color:var(--critical); font-weight:600" : ""}">${p.ko ? "⚠ " + p.ko : 0}</td>
      <td class="num">${p.fin ? Math.max(0, Math.round((D(p.fin) - D(p.debut)) / 1000)) + " s" : "—"}</td>
      <td class="muted">${p.erreurGlobale ? `<span style="color:var(--critical)">⚠ ${esc(p.erreurGlobale)}</span>` : !p.termine ? "interrompu ou en cours" : ""}</td></tr>`).join("")}</tbody></table>
      <p class="muted" style="font-size:12px">* en mode test ou simulation, rien n'est envoyé aux clients réels.</p>`
    : '<div class="vide">Aucun passage sur cette période.</div>'}
  </div>`;
}

// ───────────── Détail d'une enquête ─────────────
async function pageEnquete(id) {
  let d;
  try { d = await api("/api/enquete/" + encodeURIComponent(id)); }
  catch { return `<p><a data-retour>← Retour</a></p><div class="vide">Enquête #${esc(id)} absente du journal.</div>`; }
  const e = d.tentatives[0];
  const etapes = ["config", "bot_client", "fans", "meta"];
  const libelles = { config: "Configuration WhatsApp trouvée", bot_client: "Bot du client : enquête enregistrée (/sending)", fans: "FANS : date d'envoi enregistrée", meta: "Meta : message accepté" };
  const echec = e.erreur ? etapes.indexOf(e.erreur.etape) : 99;
  const sauteesEnTest = e.mode === "test" ? ["bot_client", "fans"] : [];
  return `
  <p><a data-retour>← Retour</a></p>
  <h1>Enquête #${e.id} ${badgeStatut(e)}${badgeMode(e.mode)}</h1>
  <div class="grille g2">
    <div class="carte">
      <h2>Dernière tentative · ${fmtDH(e.date)}</h2>
      <ul class="chrono">${etapes.map((k, i) => {
        let etat = e.statut === "simule" ? "simule" : sauteesEnTest.includes(k) ? "saute" : echec === -1 ? (i === 0 ? "ko" : "non") : i < echec ? "ok" : i === echec ? "ko" : "non";
        if (e.erreur && echec === -1 && i === 0) etat = "ko";
        const couleur = { ok: "var(--good)", ko: "var(--critical)", non: "var(--axis)", simule: "var(--warning)", saute: "var(--axis)" }[etat];
        const txt = { ok: "✓ " + libelles[k], ko: "✕ " + (echec === -1 ? "Erreur" : ETAPES[k]) + " : " + esc(e.erreur?.lisible), non: "Non exécutée", simule: "Simulée (dry-run)", saute: "Ignorée en mode test" }[etat];
        return `<li><span class="point" style="background:${couleur}"></span><div>${txt}</div></li>`;
      }).join("")}</ul>
      ${e.erreur?.fantome ? `<div class="bandeau crit" style="margin-top:8px">⚠ FANS indique cette enquête comme envoyée, mais le client n'a rien reçu. Elle ne sera pas retentée automatiquement.</div>` : ""}
      ${e.erreur ? `<details style="margin-top:12px"><summary class="lien">Message d'erreur complet du script</summary><pre>${esc(e.erreur.brut)}</pre></details>` : ""}
      ${d.tentatives.length > 1 ? `<h2 style="margin-top:16px">Tentatives précédentes</h2><table><tbody>${d.tentatives.slice(1).map((t) => `<tr><td>${fmtDH(t.date)}</td><td>${badgeStatut(t)}</td><td class="muted detail">${esc(t.erreur?.lisible || "")}</td></tr>`).join("")}</tbody></table>` : ""}
    </div>
    <div class="carte">
      <h2>Client</h2>
      <table><tbody>
        <tr><td class="muted">Prénom</td><td>${client(e)}</td></tr>
        <tr><td class="muted">Téléphone</td><td>${esc(e.telephone)} <span class="muted">(masqué)</span></td></tr>
      </tbody></table>
      <p class="muted" style="font-size:12px">Pays, importateur et marque ne figurent pas dans le journal du script (sauf dans les erreurs de configuration).</p>
      <h2 style="margin-top:16px">Actions</h2>
      <div style="display:flex; gap:8px; flex-wrap:wrap">${boutonV2("↻ Relancer")} ${boutonV2("🚫 Exclure ce numéro")}</div>
      <p class="muted" style="font-size:12px">Prévu en v2 pour le rôle Opérateur.</p>
    </div>
  </div>`;
}

// ───────────── Navigation ─────────────
let derniereEtat = null;
let numeroAffichage = 0;
async function afficher() {
  clearInterval(minuterie);
  const moiAffichage = ++numeroAffichage; // seul le dernier affichage demandé a le droit d'écrire la page
  const [, p, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("actif", a.dataset.p === (p || "")));
  try {
    const html = p === "envois" ? await pageEnvois() : p === "erreurs" ? await pageErreurs() : p === "passages" ? await pagePassages() : p === "enquete" ? await pageEnquete(arg) : await pageTableau();
    if (moiAffichage !== numeroAffichage) return;
    $("#page").innerHTML = html;
  } catch (e) {
    if (moiAffichage !== numeroAffichage) return;
    $("#page").innerHTML = `<div class="bandeau crit">Impossible de charger les données : ${esc(e.message)}</div>`;
    return;
  }
  if (!p) {
    if (derniereEtat) dessinerGraphique(derniereEtat.heures);
    minuterie = setInterval(afficher, 30000);
  }
}

document.addEventListener("click", (ev) => {
  const lien = ev.target.closest("[data-lien]");
  if (lien) { location.hash = lien.dataset.lien; return; }
  if (ev.target.closest("[data-retour]")) { history.back(); return; }
  if (ev.target.closest("[data-filtre-fantome]")) { filtres.statut = "fantome"; location.hash = "#/envois"; return; }
  if (ev.target.id === "exportCsv") { exporterCsv(); return; }
  if (ev.target.id === "basculeTable") {
    const z = $("#graphique");
    z.dataset.vue = z.dataset.vue === "table" ? "" : "table";
    ev.target.textContent = z.dataset.vue ? "Voir le graphique" : "Voir en tableau";
    dessinerGraphique(derniereEtat.heures);
  }
  if (ev.target.id === "deconnexion") fetch("/api/deconnexion", { method: "POST" }).then(() => (location.href = "/connexion"));
});
let attenteSaisie;
document.addEventListener("change", (ev) => { if (ev.target.dataset.f && ev.target.tagName === "SELECT") { filtres[ev.target.dataset.f] = ev.target.value; afficher(); } });
document.addEventListener("input", (ev) => {
  if (ev.target.dataset.f !== "q") return;
  filtres.q = ev.target.value;
  clearTimeout(attenteSaisie);
  attenteSaisie = setTimeout(async () => {
    await afficher();
    const champ = document.querySelector('[data-f="q"]');
    if (champ) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }, 350);
});
window.addEventListener("hashchange", afficher);
window.addEventListener("resize", () => derniereEtat && dessinerGraphique(derniereEtat.heures));

(async () => {
  moi = await api("/api/moi");
  $("#moi").textContent = `${moi.nom || moi.email} · ${{ lecteur: "Lecteur", operateur: "Opérateur", admin: "Administrateur" }[moi.role] || moi.role}`;
  afficher();
})();
