# Passer l'app PFlow Bots en mode « Live »

Préparé le 7 novembre 2026. ⚠️ Écrit sans accès direct à la documentation de Meta (bloquée depuis ma
session) : à partir de recherches sur les pages officielles. Les intitulés exacts peuvent varier.

## D'abord : est-ce nécessaire maintenant ? Non, pas pour le premier test

Les journaux Vercel montrent que **Meta a bien envoyé ton message au webhook** (POST
`/api/webhooks/whatsapp` le 7 novembre à 04 h 12 UTC). Le traitement a échoué uniquement parce que la
**migration C n'est pas appliquée** (« Could not find the table public.bot_webhook_evenements »).
En mode Développement, Meta envoie bien les messages du numéro de test aux destinataires de test.
→ Pour le test, il suffit d'appliquer la migration C (en attente de ton OK) puis de réécrire « Bonjour ».

Le mode **Live sera nécessaire plus tard**, pour les vrais numéros des restos (C6) : Meta demande que
toute app utilisée en production soit en Live. Tout est prêt ci-dessous pour ce jour-là.

## Ce que Meta demande (Paramètres de l'app → Général / « Basic »)

| Champ | Obligatoire ? | Valeur à mettre |
|---|---|---|
| **URL de la politique de confidentialité** | **Oui** (bloque le passage en Live si vide) | `https://www.pflow.fr/confidentialite` (une fois la nouvelle page en ligne) |
| **Suppression des données utilisateur** : URL des instructions **ou** URL de rappel (callback) | **Oui**, l'un des deux | **URL des instructions** : `https://www.pflow.fr/suppression-donnees` (pas de callback : il ne sert qu'aux connexions « Facebook Login », que PFlow Bots n'utilise pas) |
| **Icône de l'app** | **Oui** | `docs/etape-c/meta/icone-pflow-bots-1024.png` (1024 × 1024, PNG, le « P » du site). Agrandie depuis l'icône 512 du site : si tu as l'original en plus grand, prends-le |
| **Catégorie** | **Oui** | « Entreprises et pages » (*Business and Pages*) ou « Messagerie » (*Messaging*) selon la liste proposée |
| **E-mail de contact** | Oui (souvent déjà rempli) | `jules.pauwels2@gmail.com` |
| URL des conditions d'utilisation | Non | `https://www.pflow.fr/cgv` |
| Domaines de l'app | Non | `pflow.fr` |
| Vérification de l'entreprise | **Non** pour le mode Live | Nécessaire plus tard pour les vrais numéros (nom affiché, limites d'envoi) : déjà dans la checklist C0 |

**App Review** : en principe **pas nécessaire**. Les autorisations WhatsApp (`whatsapp_business_messaging`,
`whatsapp_business_management`) en accès **standard** suffisent pour tes propres comptes WhatsApp (ton
portefeuille). ⚠️ Vérifie dans **Examen de l'app → Autorisations et fonctionnalités** : si Meta exige
l'accès avancé avant le passage en Live, arrête-toi et dis-le-moi.

## Les étapes, le jour J (≈ 10 min)

1. Publier les deux pages sur pflow.fr (`docs/legal/site/`) et vérifier qu'elles s'ouvrent en navigation privée.
2. developers.facebook.com → **PFlow Bots** → **Paramètres de l'app** → **Général** : remplir le tableau ci-dessus → **Enregistrer**.
3. En haut de la page de l'app : **Mode de l'app : Développement → Live** (ou bouton **Publier**). Confirmer.
4. Vérifier : page **État** de PFlow Bots (webhook actif) et un « Bonjour » au numéro de test.

## Ce que la publication change, et ne change pas

- **Change** : l'app PFlow Bots peut être utilisée « pour de vrai » et recevoir les messages réels des comptes
  qui lui sont reliés. Aujourd'hui, elle n'est reliée qu'au **Test WhatsApp Account** (ton utilisateur système
  `pflow-bots-serveur` n'a accès qu'à l'app PFlow Bots et à ce compte de test). Donc en pratique : rien de plus
  que le numéro de test.
- **Ne change rien pour les numéros de tes clients sur UChat** : ils sont reliés à UChat (sa propre app Meta et ses
  comptes WhatsApp), pas à PFlow Bots. Le mode d'une app ne concerne que cette app.
- **Ne change rien pour tes autres apps Meta** (dont l'app des mots-clés Instagram et son examen en cours) :
  chaque app a son propre mode, ses propres réglages et ses propres autorisations.
- **Réversible** : tu peux repasser l'app en Développement à tout moment (le webhook et les réglages restent).
- Les données créées en mode Développement (messages de test) restent visibles ; rien n'est publié nulle part.
