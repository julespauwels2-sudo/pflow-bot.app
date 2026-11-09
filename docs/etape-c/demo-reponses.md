# PFlow Démo : réponses intelligentes en plein parcours

Problème constaté au test réel (vocaux transcrits par Groq) : « Salut, ça va ? » recevait « Bonne question ! Jules
vous répond très vite » + une alerte (la transcription ajoute un « ? ») ; « Est-ce que je pourrais renseigner les
horaires de mon restaurant avec le système ? » recevait la même réponse, alors que la réponse est connue.

## Ce que fait le bot maintenant

| Message du prospect | Réponse | Alerte à Jules |
| --- | --- | --- |
| Politesse seule (salut, bonjour, ça va, merci, ok, super, bonne journée…), même avec un « ? » | Réponse courte et sympa (« Ça va très bien, merci 😊 Et vous ? »), puis rappel de l'étape en cours | Non |
| Question dont la réponse est dans la base | Réponse de l'IA (1 à 3 phrases), puis rappel de l'étape (bouton de l'étape + [✅ C'est fait] [💬 Parler à Jules]) | Non |
| Question sans réponse dans la base, ou IA en panne | « Bonne question ! Jules vous répond très vite 🙂 », puis rappel | Oui |
| Prix absent de la base (options payantes), négociation (remise, réduction, geste commercial) | « Jules vous répond très vite sur ce point 🙂 » | Oui |
| Livraison (toute question) | « La livraison est en préparation : plusieurs formules arrivent bientôt. Jules vous en dit plus très vite 🙂 » (aucun prix, zone ni délai) | Oui |
| Inscription, signature, abonnement | « Super ! Jules vous recontacte très vite pour la mise en place 🙂 » | Oui |
| « Parler à Jules », « un humain », « rappelez-moi » | « Pas de souci, Jules vous répond très vite 🙂 » | Oui |
| Question avant d'avoir commencé la démo | Réponse de l'IA + [Tester la démo] [💬 Parler à Jules] (ou l'accueil si Jules doit répondre) | Seulement si Jules doit répondre |

- Alertes : notification push (seule voie), une au plus toutes les 30 min par contact, **sans pause du bot** : le
  prospect peut continuer la démo. Le transfert reste visible dans la boîte de réception.
- Livraison, inscription, négociation et demande de Jules sont repérées **sans l'IA** (mots-clés) : elles passent
  toujours par Jules, même si l'IA est en panne.
- **Garde-fous** en plus de la consigne : une réponse qui cite un montant absent de la base (ex. « 15 € ») est
  refusée et Jules est prévenu ; une réponse qui parle de livraison bascule en « livraison » ; réponse vide, JSON
  invalide, refus du modèle : Jules.
- Sans clé d'IA (`ANTHROPIC_API_KEY` absente) : comme avant, « Bonne question ! » + alerte pour toute question (la
  politesse et les catégories repérées par mots-clés marchent quand même).

## Modifier la base (sans code)

Page **Démos** → carte **« Bot PFlow Démo : base de connaissances »** : deux champs, **FAQ** (ce que PFlow propose,
une information par ligne) et **Règles** (ce que l'IA ne doit jamais dire). « Enregistrer la base » : pris en
compte dès le message suivant.

- Rangement : table `bot_fiches` existante, ligne à identifiant fixe `0f10e000-0000-4000-8000-000000000001` (aucun
  resto du CRM ne l'a ; l'enregistrement des fiches des restos ne la touche jamais). **Aucun SQL à jouer.**
- Tant qu'elle n'a pas été enregistrée, la base par défaut (pré-remplie avec la liste de Jules du 9 novembre) est
  utilisée.

## IA

- Modèle : celui du serveur (`ANTHROPIC_MODEL`, par défaut Claude Haiku 5.5), réflexion coupée, 400 jetons au plus,
  délai 15 s, 1 nouvel essai.
- Sortie JSON contrainte par un schéma : `{ statut: repondu | inconnu | inscription | prix | livraison | parler_jules, reponse }`.
- Consigne système (la base) mise en cache. Coût : de l'ordre de 0,05 centime par question.
- Code : `src/demos/demo-knowledge.ts` (base, politesse, catégories, garde-fous), `src/ai/demo-claude.ts` (appel),
  `src/channels/core/processor.ts` (`demoQuestionAnswer`), `src/demos/parcours.ts` (`guide`).
- Tests : `src/demos/__tests__/demo-reponses.test.ts` (salutation, question couverte, non couverte, prix inventé
  refusé, négociation, livraison, inscription, vocal « Salut ça va ? », IA en panne, question avant la démo).
