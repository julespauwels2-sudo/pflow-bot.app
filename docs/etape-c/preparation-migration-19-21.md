# Préparation de la migration du 19 au 21 novembre : simulation des 3 bots (10 novembre 2026, nuit)

Lecture seule : rien n'a été enregistré, ni en base ni chez Meta. Les propositions de contenu ci-dessous sont **à
valider par Jules** ; elles ne sont dans aucune fiche.

## Méthode

- Données de production lues en lecture seule (SQL) : restaurants, horaires, zones, carte, paiement (CRM) ; bots,
  flux publiés du modèle maître et copie d'ag_pizzaa, fiches (`bot_fiches`) dans PFlow Bots.
- Le **vrai moteur** du bot (`runEngine`) rejoue les conversations avec ces données, comme le simulateur. Claude
  n'est pas appelé (pas de clé dans la session) : les réponses libres de l'IA apparaissent comme « [réponse de
  l'IA] » ; pour le transfert, un faux Claude choisit `parler_equipe` quand le client demande une personne.
- Messages joués pour chaque resto : « Bonjour » (nouvelle conversation), clic « ℹ️ Infos pratiques », clics
  « 🕒 Horaires », « 🛵 Livraison », « 💳 Paiement », « Bonjour » (conversation en cours), « je veux commander »,
  « commander », « C'est quoi votre adresse ? », « Vous livrez à Baie-Mahault ? », « Je voudrais parler à
  quelqu'un », puis un nouveau client : « Salut, vous êtes ouverts ce soir ? ». Mardi 10 novembre, 11 h.

## Constat commun

- **Aucune des 3 fiches de bot n'est remplie** (`bot_fiches` vide) : seuls les champs venus du CRM existent
  (horaires, livraison / retrait, zones, carte, paiement en ligne). Vides partout : adresse, points de vente, moyens
  de paiement (texte), FAQ, règles spéciales.
- **Adresse absente dans le CRM** pour les 3 (`restaurants.adresse` vide) et nulle part ailleurs de fiable (aucun
  `place_id` ; la recherche par nom dans les découvertes ne donne que d'autres restos). Je n'ai rien inventé : à me
  donner.
- **Bouton « 🛵 Livraison » vide pour un resto en retrait seulement** (Mexico, ag_pizzaa) : le client ne recevait que
  « Ça vous tente ? ». Corrigé dans la PR n° 25 (« Pas de livraison pour le moment : les commandes sont à retirer
  sur place », avec l'adresse si elle est dans la fiche).
- Taper « livraison » ou « horaires » relance le menu « Infos pratiques » (mot-clé) au lieu de répondre directement :
  comportement du modèle, acceptable (un clic de plus). À changer seulement si tu le souhaites.
- Toutes les réponses « Commander » donnent le bon lien (`order.pflow.fr/c/<slug>`).

## Cookies An Nou (mode « toujours », IA active)

| Test | Résultat |
|---|---|
| Bonjour (nouveau) | ✅ Accueil complet (lien Commander + Me conseiller / Infos pratiques) |
| Bonjour (en cours) | ✅ version courte « Que puis-je faire pour vous ? » |
| Horaires | ✅ « Du mardi au vendredi : 8h – 12h / Fermé le lundi, le samedi et le dimanche » |
| Livraison | ⚠️ « Jarry, Dothémare, Sainte-Anne : livraison offerte » (zones du CRM) : à confirmer (voir 1) |
| Paiement | ⚠️ « Le paiement se fait *sur place*, à la livraison. » (voir 2) |
| Commander | ✅ bouton « 😋 Je commande » |
| Questions libres | IA (fiche pauvre : pas de FAQ, pas de points de vente) |
| « Parler à quelqu'un » | ✅ transfert, bot en pause 24 h |

Points à trancher :
1. **Livraison : zones ou tournées ?** Le CRM a 3 zones (Jarry, Dothémare, Sainte-Anne, offertes) et la page de
   commande les utilise. Ta correction du 4 novembre disait « livraison sur planning (tournées en entreprises) ».
   Le bot suit aujourd'hui les zones, comme la page de commande. Proposition : **garder les zones** (même chose que
   la page de commande) et ajouter une règle (ci-dessous) ; passer en « planning » seulement si la gérante annonce
   des dates.
2. **« Paiement en ligne pas encore configuré »** : dans le CRM, Cookies est réglé en paiement en ligne
   « obligatoire » (`paiement_restos.mode = obligatoire`) mais son module paiement est **désactivé** et aucun
   prestataire n'est prêt : `paiement_mode_public` répond « non ». La page de commande prend donc les commandes sans
   paiement en ligne, et le bot dit « sur place, à la livraison » (cohérent avec la page). À choisir avant le 19 :
   activer SumUp ou Stripe pour Cookies, ou laisser ainsi (l'avertissement reste sur sa fiche, sans effet pour le
   client).

Proposition de fiche (à valider, rien n'est enregistré) :
- **Points de vente** : « Stations Vito au Gosier, Total La Jaille, Esso Petit-Pérou aux Abymes et Le Boudin de
  Saint-Félix (en quantité limitée). » (ta correction du 4 novembre)
- **Moyens de paiement** (texte) : à me donner (espèces, carte à la livraison ?). L'ancienne base UChat disait
  « paiement au comptoir », ce qui ne colle pas à une livraison.
- **FAQ** :
  - « Avez-vous une boutique ? » → « Pas de boutique : nous livrons, et vous trouvez aussi nos cookies dans
    quelques stations-service (voir points de vente). »
  - « C'est quoi une box ? » → « Une box de 6, 10 ou 15 cookies, composée avec vos parfums préférés. »
  - « Je peux commander en dehors des horaires ? » → « Oui, la page de commande propose le prochain créneau. »
- **Règles spéciales** : « Pas de retrait sur place, sauf dans les points de vente (quantité limitée). Ne jamais
  proposer une autre zone de livraison que celles de la page de commande. »

## Mexico, Sainte-Rose (mode « mots-clés uniquement »)

| Test | Résultat |
|---|---|
| Bonjour (nouveau / en cours) | ✅ Accueil complet / version courte |
| Horaires | ✅ « Du lundi au dimanche : 11h30 – 15h et 18h30 – 22h » |
| Livraison | ❌ avant la PR n° 25 : rien ; après : « Pas de livraison pour le moment : à retirer sur place » |
| Paiement | ✅ « en ligne par carte au moment de la commande, ou sur place » |
| Commander | ✅ |
| Questions libres, « parler à quelqu'un », « Salut, vous êtes ouverts ce soir ? » | aucune réponse : normal en mots-clés uniquement (le gérant répond lui-même dans l'appli, comme avec UChat) |

Proposition de fiche (à valider) :
- **Adresse** : indispensable (retrait seulement). Je sais seulement « Sainte-Rose » : adresse exacte à me donner.
- **FAQ** (tirée de la carte du CRM) :
  - « Vous avez de l'agneau ? » → « Oui, le vendredi, le samedi et le dimanche (bowl, burrito, quesadillas). »
    (`jours_dispo` = vendredi, samedi, dimanche dans le CRM)
  - « Vous avez des plats végans ? » → « Oui : le bowl végan et le burrito végan. »
- **Règles spéciales** : « L'agneau n'est servi que le vendredi, le samedi et le dimanche : ne jamais le proposer
  les autres jours. »

## ag_pizzaa (mode « mots-clés uniquement »)

| Test | Résultat |
|---|---|
| Bonjour (nouveau) | ✅ mais « Bienvenue chez **ag_pizzaa** » (nom du CRM, avec le tiret bas) |
| Bonjour (en cours) | ⚠️ Accueil complet à chaque fois (pas de version courte) : copie de l'Accueil v1 |
| « commander », « je veux commander » | ❌ l'Accueil complet revient au lieu du bouton « Je commande » : la copie a le mot-clé « commander » et passe avant le modèle |
| Après chaque réponse libre de l'IA | ⚠️ la bulle « Besoin d'un petit coup de main ? » est renvoyée à chaque fois |
| Horaires | ✅ « Lundi et mardi : 18h – 21h / Du jeudi au dimanche : 18h – 21h / Fermé le mercredi » |
| Livraison | ❌ avant la PR n° 25 : rien ; après : « à retirer sur place » |
| Paiement | ✅ en ligne ou sur place |

À faire :
1. **Copie de l'Accueil** : « Revenir au modèle » (runbook, partie 5) le 19, ou avant si tu préfères. La copie n'a
   aucune personnalisation : rien n'est perdu.
2. **Nom affiché** : « ag_pizzaa » est le nom du CRM (`restaurants.nom`). Proposition : « AG Pizza » (nom utilisé
   dans la charte Instagram). Changement dans le CRM, à faire toi-même si tu es d'accord (le bot le reprend tout
   seul).
3. **Adresse** : indispensable (retrait seulement) : à me donner.

Proposition de fiche (à valider) :
- **FAQ** : « Vous livrez ? » → « Non, à emporter : commande en ligne et retrait sur place. » (redondant avec le
  bouton, utile pour l'IA du bouton « Me conseiller »).
- **Règles spéciales** : aucune nécessaire pour l'instant.

## Ce que je ne peux pas vérifier d'ici

- Les vraies réponses de Claude (pas de clé dans la session) : à tester dans le simulateur de PFlow Bots (« IA
  réelle ») après avoir rempli les fiches.
- Le comportement réel des numéros chez Meta (abonnement, coexistence) : runbook `migration-3-clients.md`.
