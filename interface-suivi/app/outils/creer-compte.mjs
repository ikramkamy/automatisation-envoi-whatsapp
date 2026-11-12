/**
 * Crée (ou remplace) un compte de l'équipe, avec un mot de passe généré affiché UNE seule fois.
 *
 *   node outils/creer-compte.mjs <email> "<Nom>" [lecteur|operateur|admin]
 */
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { creerComptes, ROLES } from "../lib/comptes.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FICHIER_CONFIG = process.env.CONFIG || path.join(ICI, "..", "config.json");
const config = fs.existsSync(FICHIER_CONFIG) ? JSON.parse(fs.readFileSync(FICHIER_CONFIG, "utf8")) : {};
const fichier = path.resolve(path.dirname(FICHIER_CONFIG), config.fichier_comptes || "comptes.json");

const [email, nom, role = "lecteur"] = process.argv.slice(2);
if (!email || !nom || !ROLES.includes(role)) {
  console.error(`Usage : node outils/creer-compte.mjs <email> "<Nom>" [${ROLES.join("|")}]`);
  process.exit(1);
}
const motDePasse = process.env.MOT_DE_PASSE || crypto.randomBytes(12).toString("base64url");
creerComptes(fichier).ajouter(email, nom, role, motDePasse);
console.log(`Compte ${email} (${role}) enregistré dans ${fichier}.`);
if (!process.env.MOT_DE_PASSE) console.log(`Mot de passe (à transmettre à la personne, il ne sera plus affiché) : ${motDePasse}`);
