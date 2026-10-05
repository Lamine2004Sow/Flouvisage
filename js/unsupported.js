/* Exécuté uniquement par les navigateurs trop anciens pour les modules JavaScript. */
(function () {
  var main = document.getElementById('main');
  if (!main) return;
  var p = document.createElement('p');
  p.className = 'fallback-message';
  p.textContent = "Votre navigateur est trop ancien pour Flouvisage. Utilisez une version récente de Chrome, Edge, Firefox ou Safari.";
  main.insertBefore(p, main.firstChild);
  var drop = document.getElementById('dropzone');
  if (drop) drop.hidden = true;
})();
