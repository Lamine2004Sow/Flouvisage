# Flouvisage

Floutage automatique des visages dans les photos et les vidéos, **entièrement dans le navigateur**. Un équivalent web de l'outil Python [deface](https://github.com/ORB-HD/deface) : aucun compte, aucun serveur, aucun envoi de fichier.

> Vos fichiers sont traités localement dans votre navigateur. Ils ne sont jamais envoyés sur un serveur.

## Fonctionnalités

- **Dépôt de fichier** par glisser-déposer ou bouton « Choisir un fichier ».
- **Images** JPG, JPEG, PNG, WebP (jusqu'à 100 Mo, 100 mégapixels).
- **Vidéos** MP4 et WebM (et MOV selon le navigateur), jusqu'à 2 Go.
- **Détection automatique** de tous les visages (position uniquement, aucune identification).
- **Trois modes d'anonymisation** : flou, pixelisation, masque de couleur ; forme ellipse ou rectangle.
- **Marge de sécurité** réglable (0 à 100 %, 25 % par défaut) qui couvre front, oreilles, menton et cheveux.
- **Seuil de confiance** réglable sans relancer l'IA (les détections brutes sont conservées).
- **Trois niveaux de performance** : Rapide, Équilibré, Haute précision.
- **Bouton « Détecter et flouter tous les visages »** : réglages par défaut puis détection complète.
- **Retouches manuelles** (images) : ajouter, supprimer, déplacer, redimensionner une zone, à la souris, au doigt ou au clavier.
- **Retouches vidéo** : supprimer un visage suivi, ajouter des zones fixes déplaçables et redimensionnables.
- **Aperçu** : Résultat, Original et curseur Avant / après pour les images ; lecture de la vidéo anonymisée avant l'export.
- **Export image** PNG, JPEG ou WebP (si le navigateur sait l'encoder) avec réglage de qualité. Les métadonnées EXIF (dont le GPS) ne sont pas recopiées.
- **Export vidéo** MP4 ou WebM selon le navigateur, son d'origine conservé quand c'est possible, choix de la résolution.
- **Suivi des visages en vidéo** entre deux détections : interpolation, lissage, prolongation avant/après chaque piste et suivi des visages qui sortent du cadre, pour éviter scintillement et disparitions.
- **Progression** (temps traité, durée, nombre de visages) et **annulation** des traitements longs.
- **Thème clair / sombre**, interface responsive et utilisable au tactile, navigation clavier.
- **PWA** : installable, utilisable hors ligne après la première visite.

## Technologies

| Rôle | Choix |
| --- | --- |
| Interface | HTML5, CSS moderne, JavaScript (modules ES natifs, sans framework ni étape de build) |
| Détection | [@vladmandic/human](https://github.com/vladmandic/human) 3.3.6 avec le seul modèle **BlazeFace** (540 Ko), basé sur TensorFlow.js 4.22 |
| Calcul | WebGL ou WebGPU, sinon WebAssembly, sinon CPU, choisis automatiquement |
| Parallélisme | Web Worker (module) pour la détection, avec repli dans la page |
| Rendu | Canvas 2D (`ctx.filter` pour le flou, repli par réduction/agrandissement sur Safari) |
| Export vidéo | `canvas.captureStream()` + `MediaRecorder`, audio via Web Audio |
| Hors ligne | Service Worker + manifeste Web App |
| Police | Bricolage Grotesque (OFL), hébergée localement |

Aucune bibliothèque n'est chargée depuis un CDN : tout est servi depuis le site lui-même.

## Installation

Le dépôt contient déjà tout ce qu'il faut (bibliothèque, modèle, fichiers WebAssembly, police). **Aucune installation n'est nécessaire.**

Node.js n'est utile que pour deux scripts de développement facultatifs :

```bash
npm install        # facultatif : récupère les dépendances pour les mettre à jour
npm run vendor     # recopie Human, le modèle, les .wasm et la police depuis node_modules
```

## Lancement en local

Les modules ES et le Web Worker exigent un serveur HTTP (l'ouverture directe de `index.html` en `file://` ne fonctionne pas).

```bash
# Avec Node.js (serveur fourni, sans dépendance)
npm start                       # http://localhost:8080

# Ou avec Python
python3 -m http.server 8080     # http://localhost:8080
```

`localhost` est considéré comme sécurisé : le Service Worker et toutes les API fonctionnent.

## Structure du projet

```
/
├── index.html                  Page unique, CSP stricte
├── manifest.webmanifest        Manifeste PWA
├── sw.js                       Service Worker (cache des fichiers statiques et du modèle)
├── _headers                    En-têtes de sécurité (Netlify, Cloudflare Pages)
├── .nojekyll                   Désactive Jekyll sur GitHub Pages
├── package.json                Scripts de développement facultatifs
├── css/
│   └── style.css               Thèmes clair/sombre, mise en page responsive
├── js/
│   ├── app.js                  Point d'entrée : thème, dépôt, vues, actions
│   ├── privacy-guard.js        Bloque tout envoi réseau (page et Worker)
│   ├── capabilities.js         Détection des fonctionnalités du navigateur
│   ├── file-validation.js      Contrôle du type MIME, de l'extension et de la taille
│   ├── geometry.js             Boîtes, marge de sécurité, fusion des doublons
│   ├── zones.js                Zones détectées et manuelles d'une image
│   ├── anonymizer.js           Flou, pixelisation, masque
│   ├── image-processor.js      Décodage, détection à résolution réduite, rendu
│   ├── export.js               Encodage d'image et téléchargement local
│   ├── unsupported.js          Message pour les navigateurs trop anciens
│   ├── detection/
│   │   ├── detector.js         Façade : Worker ou page, choix du moteur, file d'attente
│   │   ├── detector.worker.js  Web Worker de détection
│   │   ├── detector-core.js    Human / BlazeFace, découpage en tuiles
│   │   └── tiling.js           Préréglages de performance et plan des tuiles
│   ├── video/
│   │   ├── video-processor.js  Analyse de la vidéo, zones à un instant donné
│   │   ├── tracker.js          Pistes, lissage, interpolation, sortie de cadre
│   │   ├── video-exporter.js   Export MediaRecorder avec audio
│   │   ├── video-utils.js      Chargement, positionnement image par image
│   │   └── webm-duration.js    Ajoute la durée aux WebM enregistrés
│   ├── controllers/
│   │   ├── image-controller.js
│   │   ├── video-controller.js
│   │   └── shared.js           Chargement du modèle, messages d'erreur
│   └── ui/
│       ├── zone-editor.js      Édition des zones (souris, tactile, clavier)
│       ├── settings-panel.js   Réglages et valeurs par défaut
│       └── feedback.js         État, alertes, progression
├── models/
│   ├── blazeface.json          Modèle de détection de visages
│   └── blazeface.bin
├── vendor/
│   ├── human/human.esm.js      @vladmandic/human (MIT), TensorFlow.js inclus
│   └── tfjs-wasm/*.wasm        Moteur WebAssembly de TensorFlow.js
├── assets/                     Icônes et police
└── scripts/
    ├── serve.mjs               Serveur statique de développement
    └── vendor.mjs              Mise à jour des dépendances embarquées
```

## Fonctionnement

### Détection

BlazeFace analyse une entrée de 256 × 256 px. Pour trouver aussi les petits visages, l'image est analysée en entier (sans déformation) puis découpée en tuiles carrées qui se chevauchent ; les résultats sont fusionnés et remis dans les coordonnées de l'image d'origine.

| Mode | Image | Vidéo |
| --- | --- | --- |
| Rapide | image entière, détection sur 1024 px max | image entière, 640 px |
| Équilibré | entière + grilles 2 × 2 et 3 × 3, 1600 px | entière + grille 2 × 2, 960 px |
| Haute précision | entière + grilles 3 × 3 et 6 × 6, 2048 px | entière + grilles 2 × 2 et 3 × 3, 1280 px |

L'export conserve toujours la pleine résolution : seule la détection travaille sur une copie réduite.

### Vidéo

1. **Analyse** : la vidéo est parcourue à la fréquence choisie (2 à 30 détections par seconde, 5 par défaut).
2. **Suivi** : les détections sont reliées en pistes ; les positions sont lissées et interpolées entre deux analyses, chaque piste est prolongée un peu avant et après, et un visage qui sort du cadre continue d'être suivi. Une piste n'est gardée que si la médiane de ses scores atteint le seuil, ce qui écarte la plupart des fausses alertes intermittentes.
3. **Aperçu** : la vidéo anonymisée se lit directement dans la page.
4. **Export** : la vidéo est relue en temps réel, chaque image est anonymisée sur un canvas et enregistrée par `MediaRecorder`.

## Confidentialité

- Les fichiers sont lus avec l'API File et des URL `blob:` locales ; ils ne font l'objet d'**aucune requête réseau**.
- `js/privacy-guard.js` remplace `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection` et `navigator.sendBeacon`, dans la page comme dans le Worker : seules les requêtes `GET` vers le même site (code, modèle) sont autorisées, sans contenu.
- La **Content-Security-Policy** (`connect-src 'self'`, `form-action 'none'`) interdit en plus toute connexion vers un autre domaine.
- Le Service Worker ne met en cache que des fichiers statiques d'une liste connue ; les photos et vidéos ne passent jamais par lui.
- Aucun cookie, aucune statistique, aucun traceur, aucune publicité. Seul le choix du thème est mémorisé dans `localStorage`.
- Seule la **position** des visages est calculée. Les modèles de reconnaissance, d'âge, de genre ou d'émotion de Human sont désactivés et jamais téléchargés.
- L'export d'image repart des pixels : les métadonnées EXIF de l'original (appareil, GPS) ne sont pas conservées.

Pour vérifier : ouvrez les outils de développement, onglet Réseau, puis traitez un fichier. Seuls les fichiers du site apparaissent.

## Déploiement

Le projet est un site statique : publiez le dossier tel quel, sans étape de build.

### GitHub Pages

1. Créez un dépôt et poussez le contenu du dossier à la racine :
   ```bash
   git init
   git add .
   git commit -m "Flouvisage"
   git branch -M main
   git remote add origin https://github.com/<utilisateur>/<depot>.git
   git push -u origin main
   ```
2. Sur GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Le site est publié sur `https://<utilisateur>.github.io/<depot>/`. Tous les chemins sont relatifs : un sous-dossier fonctionne.

GitHub Pages ne lit pas le fichier `_headers` ; la CSP reste appliquée par la balise `<meta>` de `index.html`.

### Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git**, choisissez le dépôt.
2. Framework preset : **None**. Build command : *(vide)*. Build output directory : `/`.
3. Déployez. Le fichier `_headers` ajoute la CSP en en-tête HTTP (elle couvre aussi le Web Worker), `X-Content-Type-Options` et `Referrer-Policy`.

Sans dépôt Git : `npx wrangler pages deploy . --project-name flouvisage`.

### Netlify, Vercel ou autre hébergement statique

- **Netlify** : glissez le dossier sur app.netlify.com/drop (le fichier `_headers` est pris en compte).
- **Vercel** : `vercel deploy`, preset « Other », sans commande de build.
- **Autre serveur** : copiez les fichiers ; servez `.wasm` en `application/wasm` et `.webmanifest` en `application/manifest+json`. HTTPS est requis pour le Service Worker (sauf sur `localhost`).

### Mises à jour

Le Service Worker sert les fichiers depuis son cache. Après une modification, incrémentez `VERSION` dans `sw.js` (par exemple `flouvisage-v2`) pour que les visiteurs reçoivent la nouvelle version.

## Navigateurs pris en charge

| Navigateur | Images | Aperçu vidéo | Export vidéo |
| --- | --- | --- | --- |
| Chrome / Edge 116+ (bureau, Android) | Oui | Oui | MP4 (Chrome 126+) ou WebM |
| Firefox 115+ | Oui | Oui | WebM |
| Safari 16.4+ (macOS, iOS, iPadOS) | Oui | Oui | MP4 |

Le moteur est choisi au démarrage : WebGL ou WebGPU dans un Worker, sinon dans la page, sinon WebAssembly, puis CPU. Si WebGL n'est qu'émulé par le processeur, WebAssembly est utilisé en priorité car il est plus rapide. Le moteur utilisé est indiqué en bas de page.

## Limites connues

- **La détection n'est pas parfaite.** Des visages très petits, de profil marqué, masqués ou très flous peuvent être manqués, et des zones sans visage (mains, motifs) peuvent être floutées. Vérifiez toujours le résultat, baissez le seuil ou passez en « Haute précision » si besoin, et complétez avec des zones manuelles.
- **L'export vidéo se fait en temps réel** : il dure aussi longtemps que la vidéo. L'onglet doit rester ouvert et visible, sinon le navigateur ralentit ou suspend la lecture. Sur un appareil lent, des images peuvent être sautées (vidéo moins fluide).
- **Format de sortie vidéo** : il dépend du navigateur (MP4 sur Safari et Chrome récent, WebM sur Firefox). Le débit d'image suit la lecture ; la qualité n'est pas identique à un encodage hors ligne comme FFmpeg.
- **Son** : conservé via Web Audio. Si le navigateur refuse la lecture avec son, la vidéo est exportée sans son et un message le signale.
- **Codecs d'entrée** : seuls les codecs que le navigateur sait lire sont acceptés (H.264, VP8, VP9, AV1 selon les cas ; HEVC/H.265 souvent non pris en charge hors Safari).
- **Retouches vidéo simplifiées** : un visage suivi peut être supprimé mais pas déplacé ; les zones manuelles vidéo sont fixes sur toute la durée. Changer le seuil reconstruit les pistes et annule les suppressions de pistes.
- **Très grandes images** : sur iOS, un canvas est limité à environ 16,7 mégapixels ; une image plus grande est réduite et un message l'indique.
- **Premier chargement** : environ 2,5 Mo (bibliothèque et modèle) sont téléchargés une fois, puis servis depuis le cache.

## Licences

- Code de Flouvisage : MIT.
- [@vladmandic/human](https://github.com/vladmandic/human) : MIT (`vendor/human/LICENSE`), inclut TensorFlow.js (Apache 2.0) et le modèle BlazeFace de MediaPipe (Apache 2.0).
- Police Bricolage Grotesque : SIL Open Font License (`assets/fonts/OFL.txt`).
