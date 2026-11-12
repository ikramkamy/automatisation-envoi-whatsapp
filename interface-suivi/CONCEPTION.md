# Interface de suivi — envoi automatique WhatsApp (`autosend.mjs`)

**Statut** : v1 réalisée dans [app/](app/LISEZMOI.md) — sans modifier `autosend.mjs` : l'interface lit le journal (sortie console) du script. Les §§ 3–4 ci-dessous (événements envoyés par le script) restent la cible si un jour le script est modifié.
**Maquette** : [maquette.html](maquette.html) (données fictives, à ouvrir dans un navigateur).

---

## 1. Objectif

Permettre à l'équipe Satisfactive de répondre, sans ouvrir de terminal, à trois questions :

1. **Le script tourne-t-il ?** (dernier passage, prochain passage, erreur globale)
2. **Qu'a-t-il envoyé ?** (chaque enquête traitée, par client / marque / pays)
3. **Qu'est-ce qui a échoué, et pourquoi ?** (étape en échec, message d'erreur lisible)

**Version 1 : lecture seule.** Les actions (pause, relance…) sont **prévues dans l'architecture** mais pas activées (§ 7).

Hors périmètre de la v1 : le parcours client après l'envoi (livré / lu / répondu), les statistiques de réponse, l'accès des clients importateurs.

---

## 2. Constat sur le script actuel

`autosend.mjs` (dépôt GitHub `automatisation-envoi-whatsapp`) :

| Élément | Comportement actuel | Conséquence pour le suivi |
|---|---|---|
| Traces | `console.log` uniquement | **Rien n'est conservé** : impossible de savoir ce qui s'est passé hier |
| Boucle | Toutes les 5 min, ou `--once` via le Planificateur de tâches | Il faut savoir s'il est **vivant** (un arrêt silencieux passe inaperçu) |
| Ordre des étapes | 1. bot client `/sending` → 2. `PUT` FANS (`sent_date`) → 3. Meta | Si l'étape 3 échoue, l'enquête est **marquée envoyée dans FANS sans être partie** : elle ne sera jamais retentée. L'interface doit rendre ce cas très visible |
| Recherche de la config (`getWab`) | Comparaison exacte pays / importateur / marque | Une marque avec une espace ou une casse différente (« Jeep » vs « JEEP ») donne « aucune config WhatsApp » |
| Erreurs | Message brut (`JSON.stringify` de la réponse Meta) | À traduire en message lisible + garder le brut dans le détail |

⚠️ **Sécurité, à traiter avant tout** : `test/wab.json` contient un **vrai jeton Meta** (`token_messages`) dans le dépôt GitHub. À régénérer chez Meta et à retirer du dépôt (fichier d'exemple + `.gitignore`).

---

## 3. Architecture proposée

```
 PC / serveur où tourne le script                  VPS (Internet)
┌──────────────────────────────┐   HTTPS + clé   ┌─────────────────────────────────────┐
│ autosend.mjs                 │ ──────────────► │ API de suivi        POST /api/evenements│
│  + module « journal »        │   événements    │   │                                  │
│    (file d'attente locale si │                 │   ▼                                  │
│     le VPS est injoignable)  │ ◄────────────── │ Base SQLite (événements, passages)  │
│                              │  (v2 : commandes│   │                                  │
└──────────────────────────────┘   pause/reprise)│   ▼                                  │
                                                 │ Interface web (équipe, connexion)   │
                                                 └─────────────────────────────────────┘
```

**Pourquoi le script « pousse » ses événements** plutôt que l'interface aille les lire :
- le script peut tourner sur un PC (Planificateur de tâches) sans adresse publique ;
- l'interface reste disponible même quand le PC est éteint, et c'est justement là qu'elle doit dire « le script ne donne plus de nouvelles » ;
- la même voie servira, en v2, à renvoyer des commandes au script (§ 7).

**Si le VPS est injoignable**, le script écrit ses événements dans un fichier local (`journal/en-attente.jsonl`) et les renvoie au passage suivant. **Un problème de suivi ne doit jamais bloquer ni retarder un envoi.**

**Technique** (proposition, sans dépendance lourde) : Node.js + Express pour l'API et les pages, SQLite pour la base, pages HTML simples. Hébergement derrière le Apache/Virtualmin existant, en sous-domaine (ex. `suivi-whatsapp.satisfactive.fr`), certificat Let's Encrypt.

---

## 4. Ce que le script envoie (les événements)

Chaque événement est une petite ligne JSON. **Jamais de jeton, jamais de numéro complet** : le numéro est masqué par le script lui-même avant envoi (`593•••••1234`).

| Type | Quand | Contenu |
|---|---|---|
| `passage_debut` | Début d'un passage | identifiant du passage, mode (`normal` / `test` / `dry-run`), machine, version du script |
| `envoi_ok` | Une enquête est partie | id enquête, enquête 1/2, pays, importateur, marque, concession, numéro masqué, id du message Meta, durée |
| `envoi_erreur` | Une enquête a échoué | idem + **étape en échec** (`config` / `bot_client` / `fans` / `meta`), code HTTP, message lisible, réponse brute (tronquée) et l'indicateur **« marquée envoyée dans FANS »** |
| `passage_fin` | Fin d'un passage | nb en attente, nb traitées, nb OK, nb erreurs, durée |
| `erreur_globale` | Lecture FANS impossible, plantage… | message |
| `battement` | Toutes les minutes en mode boucle | « je suis vivant », prochain passage prévu |

Exemple :
```json
{ "type": "envoi_erreur", "passage": "2026-11-12T09:05:00Z-pc-bureau", "date": "2026-11-12T09:05:41Z",
  "enquete": 48213, "survey": 1, "pays": "ECU", "importateur": "NEXUMCORP", "marque": "PEUGEOT",
  "telephone": "593•••••4471", "etape": "meta", "http": 400,
  "message": "Meta a refusé : numéro WhatsApp inexistant", "brut": "{\"error\":{\"code\":131026,…}}",
  "marquee_envoyee_fans": true }
```

---

## 5. Les écrans (v1, lecture seule)

### 5.1 Tableau de bord
- **Bandeau d'état du script** : 🟢 Actif (dernier signe de vie il y a 2 min) · 🟠 En retard (> 10 min) · 🔴 Silencieux (> 15 min) · ⚪ Arrêté volontairement. Dernier passage, prochain passage, mode, machine.
- **Chiffres du jour** : en attente dans FANS, envoyées, erreurs, **marquées envoyées mais non parties** (en rouge si > 0).
- **Graphique** : envois et erreurs par heure sur 24 h.
- **5 dernières erreurs** avec lien vers le détail.

### 5.2 Envois
Tableau de toutes les enquêtes traitées, filtrable par période, statut, pays, importateur, marque, enquête 1/2 ; recherche par n° d'enquête. Export CSV.

### 5.3 Erreurs
Erreurs regroupées **par cause** (« aucune config WhatsApp pour ECU / X / Jeep » × 12) plutôt qu'une liste brute : on voit tout de suite ce qu'il faut corriger. Filtre « marquées envoyées mais non parties ».

### 5.4 Passages
Historique des passages : heure, durée, en attente / traitées / OK / erreurs, mode. Un passage en `dry-run` ou `test` est clairement étiqueté.

### 5.5 Détail d'une enquête
Chronologie des tentatives (étape par étape), client (pays, importateur, marque, concession, numéro masqué), message d'erreur lisible + réponse brute repliée. **Emplacement réservé** pour les actions v2 (boutons grisés « bientôt »).

---

## 6. Accès de l'équipe

- Connexion par **e-mail + mot de passe** (ou lien magique par e-mail), comptes créés par un administrateur, pas d'inscription libre.
- **Rôles prévus dès la v1**, même si un seul est utile au départ :

| Rôle | v1 | v2 |
|---|---|---|
| Lecteur | Voit tout (numéros masqués) | idem |
| Opérateur | = lecteur | Pause / reprise, relance d'une enquête en erreur |
| Administrateur | Gère les comptes | + réglages (fréquence, délai entre envois, limite par passage) |

- Journal d'audit : qui s'est connecté, et en v2 qui a fait quelle action.

---

## 7. Prévoir l'écriture (v2) sans la construire maintenant

Ce qui est fait **dès la v1** pour que la v2 soit simple :
1. **Rôles** déjà en base (§ 6).
2. **Table `commandes`** créée vide : `{ id, type, cible, demandee_par, date, statut }`.
3. Le script, à chaque `battement`, demande « y a-t-il une commande pour moi ? ». En v1 la réponse est toujours « non ».
4. Emplacements des boutons déjà dessinés dans la maquette (grisés).

Commandes envisagées en v2, **toujours exécutées par le script lui-même** (l'interface n'envoie jamais de message WhatsApp directement) :

| Commande | Effet |
|---|---|
| `pause` / `reprise` | Le script saute ses passages tant qu'il est en pause |
| `relancer` (enquête) | L'enquête est retentée au prochain passage |
| `exclure` (numéro) | Le numéro n'est plus jamais contacté |
| `reglages` | Fréquence, délai entre envois, limite par passage |

---

## 8. Alertes (proposées)

| Situation | Alerte |
|---|---|
| Plus de battement depuis 15 min (hors arrêt volontaire) | E-mail à l'équipe |
| Enquête « marquée envoyée dans FANS mais non partie » | E-mail immédiat |
| Plus de 5 erreurs de la même cause dans un passage | E-mail récapitulatif |
| Erreur globale (FANS illisible) | E-mail |

Peut aussi être relayé par Uptime Kuma (sonde « push » sur le battement), déjà prévu pour les instances Supabase.

---

## 9. Étapes de réalisation proposées

1. **Sécurité** : retirer le jeton de `test/wab.json`, le régénérer.
2. **Module « journal » dans `autosend.mjs`** : événements en JSON (fichier local d'abord). Testable sans interface.
3. **API de suivi + base** sur le VPS, avec une clé par machine.
4. **Écrans v1** (tableau de bord, envois, erreurs, passages, détail) + connexion.
5. **Alertes**.
6. Plus tard : v2 (actions), puis parcours client (livré / lu / répondu, via le webhook des bots).

---

## 10. Questions encore ouvertes

1. **Où tourne `autosend.mjs` aujourd'hui ?** (PC du bureau avec le Planificateur de tâches, ou serveur ?) — cela change seulement la façon dont il atteint l'API.
2. **Quel VPS** pour l'interface ? (185.98.138.203 est presque plein en mémoire selon la session « Supabase » ; une petite application Node + SQLite consomme peu, ~100 Mo.)
3. **Combien de personnes** dans l'équipe, et qui sera administrateur ?
4. **Les numéros complets** doivent-ils être visibles pour certains rôles (pour rappeler un client), ou toujours masqués ?
5. **Combien de temps garder l'historique** ? (proposition : 13 mois)
