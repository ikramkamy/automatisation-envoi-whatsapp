document.getElementById("formulaire").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const erreur = document.getElementById("erreur");
  erreur.textContent = "";
  const r = await fetch("/api/connexion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: document.getElementById("email").value, motDePasse: document.getElementById("mdp").value }),
  });
  if (r.ok) location.href = "/";
  else erreur.textContent = (await r.json().catch(() => ({}))).erreur || "Connexion impossible.";
});
