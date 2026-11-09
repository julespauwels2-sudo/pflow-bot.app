# Messages vocaux : transcription

Préparé le 9 novembre 2026. Quand un client envoie un vocal WhatsApp, le bot le comprend comme un message écrit.
**Rien n'est actif tant que la clé n'est pas dans Vercel.**

## 1. Comparatif des services (tarifs vérifiés le 9 novembre 2026)

| | **Groq** (whisper-large-v3-turbo) | OpenAI (gpt-4o-mini-transcribe) | Mistral (Voxtral Mini Transcribe) |
|---|---|---|---|
| Prix | **0,04 $ / heure**, soit ≈ 0,00067 $ / min (minimum facturé : 10 s par vocal) | ≈ 0,003 $ / min | 0,003 $ / min (V2) ; ≈ 0,0035 $ / min annoncé pour la V3 (non confirmé) |
| Français | bon (Whisper large v3) | bon, un peu meilleur sur l'audio bruité | bon |
| Créole guadeloupéen | non pris en charge officiellement | non pris en charge officiellement | non pris en charge officiellement |
| Délai | le plus rapide des trois (puces dédiées) | quelques secondes | quelques secondes |
| Données | société américaine | société américaine | société européenne |

**Créole** : aucun des trois ne connaît le créole guadeloupéen. Le code demande le français :
- les phrases mêlées de créole sortent en orthographe française approchée ;
- l'IA du bot comprend souvent le sens ;
- un mot-clé exact (« je veux le mien ») peut ne pas être reconnu ;
- une indication de vocabulaire guadeloupéen (lieux, plats) est envoyée à Groq et à OpenAI ;
- **non testé sur de vrais vocaux en créole** : à vérifier avec 5 ou 6 vocaux réels.

Sources :
- [Groq, Whisper Large v3 Turbo à 0,04 $ / heure](https://groq.com/?p=5392)
- [Groq, documentation du modèle](https://console.groq.com/docs/model/whisper-large-v3-turbo)
- [Suivi des tarifs Groq, octobre 2026](https://www.morphllm.com/groq-pricing)
- [Tarifs de transcription OpenAI 2026](https://diyai.io/ai-tools/speech-to-text/openai-whisper-api-pricing-2026/)
- [Annonce Mistral, Voxtral Transcribe 2](https://mistral.ai/fr/news/voxtral-transcribe-2)
- [OpenRouter, Voxtral Mini Transcribe](https://openrouter.ai/mistralai/voxtral-mini-transcribe/pricing)

Les tarifs OpenAI et Mistral V3 viennent de sites qui suivent les prix, pas des pages officielles.

### Recommandation : Groq

C'est le moins cher, environ **4,5 fois moins** qu'OpenAI ou Mistral. C'est aussi le plus rapide, ce qui compte
puisque le client attend la réponse. Le modèle Whisper large v3 est éprouvé en français. Changer de service ne
demande qu'une variable (`TRANSCRIPTION_PROVIDER=openai` ou `mistral`) : le code des trois est en place.

### Coût estimé

Hypothèse : vocaux de 20 s en moyenne.

| Volume | Groq | OpenAI / Mistral |
|---|---|---|
| 1 vocal | ≈ 0,0002 $ | ≈ 0,001 $ |
| 300 vocaux / mois (100 min) | **≈ 0,07 $ / mois** | ≈ 0,30 $ / mois |
| 3 000 vocaux / mois | ≈ 0,67 $ / mois | ≈ 3 $ / mois |

Pire cas pour un seul contact, grâce aux limites : 10 vocaux de 2 min par jour, soit ≈ 0,013 $ par jour avec Groq.

## 2. Mécanisme

1. WhatsApp envoie la notification du vocal : identifiant du média, sans le fichier.
2. Le bot vérifie le **plafond du contact** : vocaux déjà transcrits sur les dernières 24 h, comptés dans les messages
   (aucune colonne en base). Plafond atteint : rien n'est téléchargé.
3. **Téléchargement** du fichier par l'API de Meta, avec le token, **en mémoire seulement**.
4. **Durée** lue dans le fichier (Ogg Opus, format des vocaux WhatsApp), sans service extérieur. Trop long : pas de
   transcription.
5. **Transcription** (Groq), en français.
6. Le texte est traité **comme un message écrit** : parcours de démo, mots-clés, IA.

`src/channels/core/processor.ts` (`transcribeVoice`), `src/channels/voice/transcriber.ts`, `src/channels/voice/duration.ts`.

## 3. Limites et réponses

| Cas | Réponse du bot |
|---|---|
| Vocal de plus de 2 min (`TRANSCRIPTION_MAX_SECONDES`, 120 par défaut) | « Votre vocal est un peu long (plus de 2 minutes) : pouvez-vous l'écrire, ou envoyer un vocal plus court ? » |
| Plus de 10 vocaux transcrits sur 24 h pour ce contact (`TRANSCRIPTION_MAX_PAR_JOUR`, 10 par défaut) | « J'ai bien reçu votre vocal, mais je ne peux plus en écouter aujourd'hui : pouvez-vous m'écrire votre message ? » |
| Échec ou vocal inaudible | « Je n'ai pas bien compris votre vocal, pouvez-vous l'écrire ? » |

Comportement commun :
- si une question du bot attendait une réponse, elle est reposée après ce message ;
- contact en pause (Jules a la main) : le bot ne répond rien, mais le vocal est transcrit pour la boîte de réception ;
- sans clé : comportement d'avant (« Je ne peux lire que les messages écrits… » si une question attend).

## 4. Boîte de réception

- Vocal transcrit : « 🎤 Message vocal (0:23) » puis la transcription entre guillemets.
- Vocal non transcrit : « 🎤 Message vocal (3:00) : non transcrit (trop long), le bot a demandé d'écrire » (ou
  « plafond du jour atteint », « non compris »).

## 5. Données

- **Aucun fichier audio n'est stocké** : téléchargé en mémoire, envoyé au service, oublié. Seuls la transcription,
  la durée et le statut sont gardés avec le message, et supprimés avec lui (purge à 12 mois). Un test le vérifie.
- Le fichier reste sur les serveurs de Meta, selon leurs règles ; on ne le garde pas.

## 6. À faire par Jules

1. Créer un compte sur **console.groq.com**, puis **API Keys** → **Create API Key**.
2. Dans Vercel (pflow-bot-app), en Production, ajouter la variable **`TRANSCRIPTION_API_KEY`**, type **Sensitive**.
   La clé ne passe ni par le code ni par une conversation.
3. Redéployer. Sur la page État, « Messages vocaux » doit afficher « actifs », service groq.
4. Envoyer 3 vocaux de test au numéro PFlow Démo :
   - « tester la démo » ;
   - une question en français ;
   - une phrase en créole.

Variables facultatives :
- `TRANSCRIPTION_PROVIDER` : `groq` par défaut ;
- `TRANSCRIPTION_MAX_SECONDES` : 120 par défaut ;
- `TRANSCRIPTION_MAX_PAR_JOUR` : 10 par défaut.

## 7. Tests

`src/channels/voice/__tests__/voice.test.ts` :
- **Groq** : format de l'appel, modèle, français, indication de vocabulaire ; service par défaut avec la seule clé ;
- **durée** lue dans un fichier Ogg Opus ;
- **vocal de 23 s** : transcrit, même réponse qu'au texte, boîte de réception « vocal (0:23) + transcription », aucun
  octet audio ni adresse de fichier enregistrés ;
- **vocal de 3 min** : aucun appel au service, réponse « trop long » ;
- **vocal inaudible** : « Je n'ai pas bien compris… » ;
- **plafond** (2 en test) : le 3e n'est ni téléchargé ni transcrit, réponse « plafond » ;
- **contact en pause** : aucune réponse ;
- **service en panne** : erreur notée, réponse claire.
