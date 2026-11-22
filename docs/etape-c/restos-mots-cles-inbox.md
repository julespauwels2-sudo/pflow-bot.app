# Bots des restos et boîte de réception : corrections du 21 novembre 2026 (soir de bascule)

Contexte : depuis le 21 novembre, les 3 restos sont actifs : Cookies An Nou en mode « toujours », Mexico et AG Pizza en
« mots-clés uniquement ». Cette PR part de la PR n° 37 (réponse manuelle affichée tout de suite), qui n'était pas
fusionnée, et la contient.

## Ce que montrent les vrais messages de Mexico (21 novembre, heure de Guadeloupe)

- **« Commande » ignoré à 18 h 56, 19 h 11 et 19 h 19** : le mot-clé n'existait pas encore. L'Accueil du modèle maître
  a été publié en v5 à 19 h 19 avec « commander » et « commande ». À 19 h 28, « Commande » a bien reçu l'accueil
  complet (🌯). Vérifié en base : Mexico et AG Pizza n'ont aucune copie de l'Accueil, ils suivent donc le modèle maître.
- **« Bonjour, je viens de passer la commande n° 35… » (18 h 22) : deux causes.**
  1. Le client était en **pause « l'équipe a répondu »** : l'équipe lui avait répondu à la main à 18 h 15. Le bot
     devait se taire 12 h, et ce point ne change pas.
  2. Même sans cette pause, la phrase aurait été ignorée : au-delà de 4 mots, un mot-clé ne comptait pas.
- **« Commande » à 19 h 20, contact qui avait écrit 1 min plus tôt** : il a reçu le menu court « Que puis-je faire pour
  vous ? » au lieu de l'accueil complet.
- **Transfert de 17 h 35, puis « Vous avez des quesadillas ? » à 18 h 10 et 18 h 11** : ignorés sans aucune trace.

## Partie 1 : le bot des restos

### 1. Mots-clés
- **« commander »** est aussi un mot-clé de « CTA - Commander ». À longueur égale, c'était l'ordre des flux qui
  décidait. Maintenant, **le flux par défaut (Accueil) gagne**. « je commande » reste au CTA.
- **Le modèle de référence (seed)** a lui aussi « commander » et « commande » dans l'Accueil, comme la production.
- **Règle pour les phrases (mode « mots-clés uniquement » seulement, 20 mots au plus)** : une phrase lance un flux si
  - elle **commence par un mot-clé** (« Commande pour ce soir svp », « Menu ? ») ;
  - ou elle **commence par une salutation ET contient un vrai mot-clé**, c'est-à-dire autre chose qu'une salutation
    (« Bonjour, je viens de passer la commande », « Bonsoir, c'est quoi vos horaires ? »).
- **Pourquoi cette règle est sûre pour les conversations perso du gérant** :
  - « Salut tu viens ce soir ? », « Bonjour madame comment allez-vous » ou « Ok merci 🙏 » ne contiennent aucun vrai
    mot-clé, donc restent ignorés ;
  - un mot-clé au milieu d'une longue phrase perso ne compte pas ;
  - au-delà de 20 mots, rien n'est reconnu ;
  - limite connue : un ami qui écrit « Salut, tu peux passer chercher la commande ? » recevra l'accueil.
- **Mode « toujours » (Cookies)** : inchangé, les phrases vont à l'IA. Seule exception nouvelle : une question qui
  contient un mot-clé de l'Accueil (« ma commande est où ? ») va à l'IA (suivi de commande), pas à l'accueil.
- **Écriture du client** : accents, majuscules, ponctuation et emojis ne comptent pas (« COMMANDE !!! », « Commandé 🍔 »
  et « commande. » sont testés).

### 2. Transfert vers l'équipe
- Pendant une pause de **transfert**, un mot-clé du client (bonjour, commande, menu…) **rend la main au bot** : il
  répond tout de suite, et le transfert est **marqué résolu** dans la boîte de réception.
- **Pause « l'équipe a répondu »** (réponse depuis l'appli WhatsApp Business ou depuis la boîte de réception) : le bot
  reste silencieux 12 h après la dernière réponse, même si le client écrit « Bonjour ».
  - Si l'équipe répond pendant un transfert, cette pause de 12 h remplace celle du transfert (24 h).
- Quand une pause de transfert se termine d'elle-même, le transfert est aussi marqué résolu.
- « Reprendre la main » (pause sans fin) n'est jamais levé par un mot-clé.

### 3. Accueil
- Une salutation ou un mot-clé de l'Accueil (bonjour, commande, commander, menu…) affiche **toujours l'accueil
  complet** : « Bienvenue chez … 🌯 », le bouton Commander, puis « Besoin d'un petit coup de main ? ». C'est vrai même
  si le contact vient d'écrire.
- **Le menu court « Que puis-je faire pour vous ? » ne sert plus que dans deux cas :**
  - un autre flux qui renvoie vers l'Accueil (bloc « Aller à un flux ») sans nouvelle conversation ;
  - en mode « toujours », quand l'IA est indisponible (clé absente, panne) et que le message n'est pas une salutation,
    dans une conversation de moins de 12 h.

### 4. Messages ignorés
- La raison est gardée sur le message reçu (colonne `erreur` de `bot_messages`, **aucune migration**) et affichée dans
  la boîte de réception :
  - « Ignoré : pas de mot-clé » ;
  - « Pas de réponse : bot en pause (transfert) » ;
  - « Pas de réponse : l'équipe a répondu (pause 12 h) » ;
  - « Pas de réponse : tu as repris la main » ;
  - « Pas de réponse : type de message non géré ».

### Numéro PFlow (PFlow Démo, Mint Bun) : inchangé
Aucune de ces règles ne s'y applique : un mot-clé ne lève pas un transfert, le 2e « Bonjour » donne toujours le menu
court, et les phrases ne sont pas reconnues. Testé.

## Partie 2 : la boîte de réception

### Audit (captures « avant » : `captures-inbox-21nov/avant-*.png`)
1. **Liste groupée par numéro**, sans tri d'ensemble. Les transferts ouverts restaient en haut, même anciens.
2. **Pas de non-lus sur ordinateur** (seulement sur téléphone).
3. **Aucune trace quand le bot ne répond pas** (« Commande » de Naomi, message perso de Tonton Max).
4. **Pause expirée encore affichée « Bot en pause »**, avec « Rendre au bot » : la liste ne vérifiait pas l'heure de fin.
5. **« 🔔 Attend l'équipe » pour toujours** : un transfert n'était résolu que par « Rendre au bot », même quand le bot
   avait repris tout seul.
6. **Deux badges pour un même état** sur ordinateur (« Attend l'équipe » + « Bot en pause (transfert) »).
7. **Réponse depuis la boîte de réception** : la pause de 12 h était notée « main reprise », ce qui la confondait avec
   « Reprendre la main » (sans fin).
8. **Pas de filtre par resto. Numéros de test Meta (+1 555, 2e numéro de Cookies) toujours visibles.**
9. **Messages de l'appli WhatsApp Business illisibles** : « (reaction) », « (edit) », « (unsupported) ».
10. **Qui parle, pas clair** : le bot et l'équipe à droite avec une petite étiquette ; « Gérant (appli) » d'un côté,
    « Toi » ou « Équipe » de l'autre ; heure avec la date sur chaque bulle ; extrait de la liste précédé de « ↪ »
    (bot ou équipe ?).

### Corrigé (captures « après » : `captures-inbox-21nov/apres-*.png`)
- **Un état unique par conversation**, calculé par le serveur :
  - « 🤖 Bot actif » ;
  - « 🔔 En pause : transfert (jusqu'à …) » ;
  - « ⏸ En pause : l'équipe a répondu (jusqu'à …) » ;
  - « ✋ En pause : tu as repris la main » ;
  - « 🚫 Ignoré : pas de mot-clé ».
  Une pause terminée n'est plus affichée. « Attend l'équipe » seulement si le transfert est ouvert ET le bot en pause.
- **« 🤖 Rendre au bot »** pour toutes les pauses, avec une phrase qui explique chaque état et ce que fait le bouton.
- **Liste unique triée par dernier message**, non-lus (gras et point) sur ordinateur comme sur téléphone, extrait qui
  dit qui a écrit (🤖 / « 👩‍🍳 Équipe : »).
- **Filtre par resto** et case « Numéros de test Meta (n) », décochée par défaut.
- **Bulles** :
  - client à gauche ;
  - « 🤖 Bot » en bleu ;
  - « 👩‍🍳 Équipe · appli WhatsApp » ou « 👩‍🍳 Équipe · boîte de réception » en rose ;
  - heure sur chaque bulle, séparateur par jour ;
  - raison sous un message du client resté sans réponse ;
  - réactions et modifications lisibles.
- **Réponse depuis la boîte** : pause « l'équipe a répondu » (12 h), comme depuis l'appli.

### Ce qui reste
- **Pas de vraie mémoire « lu »** partagée entre appareils : les non-lus restent propres à chaque appareil
  (localStorage).
- **Rafraîchissement toutes les 5 s** (pas de temps réel).
- **Pas de recherche** dans les conversations.
- **Les messages ignorés avant cette PR n'ont pas de raison.** Seuls les nouveaux sont marqués.
- **Les états Instagram suivent les mêmes règles**, mais n'ont pas été testés avec un vrai compte.
- **Messages envoyés à la main avec le texte du bot** (le gérant a recopié l'accueil à 18 h 57) : ils sont bien notés
  « Équipe », mais rien n'empêche ce doublon. À expliquer aux gérants.
