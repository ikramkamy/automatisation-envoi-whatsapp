# Interface de suivi — envoi automatique WhatsApp (v1, lecture seule)

Une page web pour l'équipe Satisfactive qui montre **si `autosend.mjs` tourne**, **ce qu'il a envoyé** et **ce qui a échoué**.

- **`autosend.mjs` n'est pas modifié.** L'interface lit les messages qu'il écrit déjà dans la console.
- **Rien n'est envoyé :** l'interface n'appelle jamais FANS ni Meta.
- **Numéros toujours masqués** (`593•••••4567`), noms réduits au prénom + initiale.
- **Aucune dépendance npm** : Node.js 18 ou plus suffit.

```
app/
├── serveur.mjs              le serveur (pages + API en lecture seule)
├── lib/journal.mjs          lecture du journal du script
├── lib/comptes.mjs          comptes de l'équipe (mots de passe hachés) et sessions
├── public/                  les pages (tableau de bord, envois, erreurs, passages, détail)
├── outils/creer-compte.mjs  créer un compte
├── outils/generer-journal-demo.mjs   faux journal pour essayer
├── config.exemple.json      à copier en config.json
├── demo/                    démo prête à l'emploi (journal fictif)
└── test/tests.mjs           26 tests
```

---

## 1. La seule chose à changer côté script : son lancement

Le code du script ne change pas. Il faut seulement **garder ses messages dans un fichier** au lieu de les laisser disparaître dans la fenêtre :

**Invite de commandes (cmd) ou Planificateur de tâches :**
```
node autosend.mjs >> C:\suivi\autosend.log 2>&1
```

**PowerShell :**
```
node autosend.mjs *>> C:\suivi\autosend.log
```
(Windows PowerShell 5 écrit ce fichier en UTF-16 : l'interface le lit aussi.)

Dans le **Planificateur de tâches** (mode `--once`) : action « Démarrer un programme » → programme `cmd.exe`, arguments
`/c node C:\chemin\autosend.mjs --once >> C:\suivi\autosend.log 2>&1`, dossier de démarrage = dossier du script.

> L'interface doit pouvoir lire ce fichier : **elle tourne donc sur la même machine que le script** (ou sur une machine qui voit ce fichier, ex. dossier partagé).

---

## 2. Installer et lancer l'interface

```
cd app
copy config.exemple.json config.json        (puis renseigner fichier_journal)
node outils/creer-compte.mjs prenom@satisfactive.net "Prénom Nom" admin
node serveur.mjs
```
Ouvrir **http://localhost:8780** et se connecter. Le mot de passe affiché par `creer-compte` ne l'est qu'une fois.

| Réglage (`config.json`) | Rôle |
|---|---|
| `fichier_journal` | chemin du fichier journal du script |
| `fichier_comptes` | fichier des comptes (créé automatiquement) |
| `port`, `hote` | `127.0.0.1` = accessible seulement depuis la machine ; `0.0.0.0` = depuis le réseau |
| `cookie_securise` | `true` dès que l'interface est servie en **HTTPS** |
| `seuils` | minutes avant « en retard » (10) et « silencieux » (15) |

Pour **l'ouvrir à toute l'équipe** depuis Internet : la mettre derrière Apache (Virtualmin) en HTTPS avec un sous-domaine, `hote` = `127.0.0.1`, `cookie_securise` = `true`. Ne pas exposer le port 8780 directement.

Pour la garder allumée : `pm2 start serveur.mjs --name suivi-whatsapp` (ou une tâche Windows au démarrage).

---

## 3. Essayer tout de suite (démo, données inventées)

```
cd app
set CONFIG=demo\config.json
node outils/generer-journal-demo.mjs demo/autosend.log
node outils/creer-compte.mjs demo@satisfactive.test "Démo" admin
node serveur.mjs
```
(en PowerShell : `$env:CONFIG="demo\config.json"` au lieu de `set CONFIG=…`)

La 2ᵉ ligne refabrique un journal fictif qui se termine maintenant ; la 3ᵉ affiche le mot de passe du compte de démo. Ouvrir ensuite http://localhost:8780.

---

## 4. Ce que montre l'interface

| Page | Contenu |
|---|---|
| **Tableau de bord** | Voyant 🟢 actif / 🟠 en retard / 🔴 silencieux, dernier et prochain passage, chiffres du jour, envois par heure (24 h), dernières erreurs. Actualisation toutes les 30 s |
| **Envois** | Toutes les enquêtes traitées : statut, étape en échec, détail ; filtres période / statut ; recherche par n° d'enquête ou 4 derniers chiffres ; export CSV |
| **Erreurs** | Regroupées par cause avec un conseil ; erreurs globales (FANS illisible) |
| **Passages** | Chaque passage : en attente, traitées, envoyées, erreurs, durée, mode (test / dry-run) |
| **Détail** | Étapes cochées ou en échec, message d'erreur complet, tentatives précédentes |

**⚠ « Marquée envoyée, non partie »** : le script écrit la date d'envoi dans FANS **avant** d'appeler Meta. Si Meta refuse, FANS croit l'enquête partie et le script ne la retentera jamais. Ces cas sont mis en avant en rouge.

### Limites (le script n'écrit pas ces informations)
- Pays, importateur, marque et concession ne sont connus que pour les erreurs de configuration.
- Le statut WhatsApp après l'envoi (livré, lu, répondu) n'est pas suivi : il est chez Meta / dans les bots des clients.
- « En attente dans FANS » est la valeur lue au dernier passage du script.

---

## 5. Comptes et sécurité
- Rôles : **lecteur**, **operateur**, **admin**. En v1 ils voient tous la même chose (lecture seule).
- Mots de passe hachés (scrypt), jamais stockés en clair ; 5 essais ratés → blocage 10 min.
- Session de 12 h dans un cookie `HttpOnly`, `SameSite=Strict` (`Secure` en HTTPS).
- Toute requête d'écriture est refusée (`405`). Seul le dossier `public/` est servi.
- Les fichiers `config.json`, `comptes.json` et le journal ne doivent pas aller sur GitHub.

## 6. Prévu pour la v2 (écriture)
Les boutons « Mettre en pause », « Relancer », « Exclure ce numéro » sont déjà en place, grisés (étiquette **v2**), et l'emplacement des actions est réservé dans `serveur.mjs`. Les activer demandera **une modification du script** (qu'il lise les demandes de l'interface) : à décider le moment venu.

## 7. Tests
```
node test/tests.mjs
```
Lecture du journal au format exact du script (OK, erreurs, dry-run, mode test, erreur globale, UTF-16), état actif / retard / silencieux, connexion, lecture seule, aucun numéro complet ni hash dans les réponses, pas d'accès hors du dossier public.
