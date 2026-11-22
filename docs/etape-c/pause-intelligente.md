# Pause intelligente après une réponse de l'équipe (22 novembre 2026)

Remplace la pause de 12 h après une réponse manuelle de l'équipe (appli WhatsApp Business ou boîte de réception)
sur les numéros des restos. Le numéro PFlow (démos) garde la pause de 12 h.

## La règle
1. L'équipe répond à la main : le bot se tait pour ce client.
2. Le client écrit ensuite : le bot ne répond pas tout de suite, il programme une reprise **10 min après le premier
   message laissé sans réponse**. Les messages suivants ne repoussent pas l'heure.
3. L'équipe répond avant l'heure : la reprise est annulée, le bot reste silencieux. Le délai repart au prochain message
   du client.
4. Personne n'a répondu à l'heure : le bot répond aux derniers messages du client.
   - **Un mot-clé** lance son flux, comme d'habitude.
   - **Sinon, l'IA répond**, même en mode « mots-clés uniquement ». Elle lit la conversation des 12 dernières heures,
     réponses de l'équipe comprises, avec des règles prioritaires :
     - ce que l'équipe a dit fait foi (« on n'a plus de crème » : jamais de crème) ;
     - elle ne la contredit jamais et ne répète pas ce qu'elle a dit ;
     - si elle ne sait pas, elle propose de commander ou d'attendre l'équipe.
   - **Sans IA** (clé absente) : l'accueil complet.
5. Après la réponse du bot, le bot est actif jusqu'à la prochaine réponse de l'équipe.
5 bis. **Numéros « mots-clés uniquement »** (Mexico, AG Pizza, aussi utilisés par le gérant pour ses conversations
   perso) : la reprise n'a lieu que pour un client à qui le bot a déjà parlé. Un ami qui répond au gérant n'aura
   jamais de réponse du bot.
6. Le client n'écrit pas : le bot ne dit rien. Au bout de 12 h, la pause tombe et le bot répond normalement.
7. **Transfert** (le client a demandé quelqu'un) : inchangé.
8. **Délai réglable** dans la fiche de chaque resto : « Reprise du bot après une réponse de l'équipe », 10 min par défaut,
   de 2 à 240 min.

## Technique : tâche planifiée à la minute
- **Aucune nouvelle table ni colonne.**
  - Pendant que le client attend, la fin de pause (`bot_contacts.pause_jusqu_a`) devient l'heure de reprise.
  - Le message laissé sans réponse est déjà noté « l'équipe a répondu » (`bot_messages.erreur`).
- **`/api/cron/reprise`** (Vercel Cron, `* * * * *`, protégé par `CRON_SECRET` comme les autres tâches) :
  1. lit les pauses « l'équipe a répondu » échues depuis moins d'1 h ;
  2. garde celles dont le dernier message est celui du client ;
  3. fait répondre le bot, par le même chemin qu'un message WhatsApp (envoi, boîte de réception, alertes).
- **Jamais deux réponses** : chaque reprise a un identifiant unique (contact + heure), réservé comme un message reçu.
- **Précision** : le bot répond entre 10 et 11 min après le message du client. La tâche passe chaque minute, et c'est
  la plus petite période de Vercel Cron.
- **Pourquoi pas une file d'attente** (QStash, Inngest, pg_cron) : un service de plus à brancher et à surveiller. Le
  plan Vercel Pro fait déjà tourner une tâche à la minute (`/api/cron/demo`), le même mécanisme suffit.

## Coût
- **Vercel** : 1 440 appels par jour, environ 43 000 par mois. Chacun dure ~0,1 à 0,3 s, avec 2 lectures Supabase quand
  il n'y a rien à faire. Le tout reste dans ce que comprend le plan Pro.
- **Supabase** : ~90 000 petites lectures par mois, négligeable.
- **IA** : un appel seulement quand le bot reprend vraiment, environ 0,001 $ avec le modèle actuel. Rien les autres
  minutes.

## Boîte de réception
- **Client en attente** : « ⏸ En pause : l'équipe a répondu (le bot reprend à HH:MM si personne ne répond) ».
- **Sans client en attente** : « ⏸ En pause : l'équipe a répondu (si le client réécrit, le bot reprend après 10 min sans
  réponse) ».
- **Sous le message du client** : « En attente : l'équipe a répondu récemment (le bot reprend si personne ne répond) ».

## Ce qui reste
- **Le simulateur ne simule pas la reprise** : pas de tâche planifiée, la pause y reste comme avant.
- **Une reprise manquée plus d'1 h** (tâche Vercel arrêtée) n'est pas rattrapée. C'est voulu : on ne répond pas des
  heures après.

## Ajout : conversation ouverte en mode mots-clés (bug de Mexico, 22 novembre)

### Le bug
- 21 h 39 : « Bonjour je souhaite passer commande » ouvre « CTA - Commander » (« passer commande » est le mot-clé le plus
  long).
- 21 h 40 : « Je veux parler à quelqu'un » est ignoré (« ignore:aucun_declencheur »).

### Ce qui existait déjà dans le moteur
- **La session** (`bot_sessions`, 30 min d'inactivité, réglage `session_minutes` du canal) n'existe que tant qu'un bloc
  attend une réponse. Après l'Accueil, qui attend un clic, une question allait donc déjà à l'IA. Le CTA n'attend rien :
  le flux se termine, la session est effacée, et le message suivant demande de nouveau un mot-clé.
- **« Nouvelle conversation »** (12 h) ne sert qu'à choisir entre accueil complet et menu court.
- **La fenêtre de 24 h de Meta** sert aux messages libres.

Aucune ne couvrait le cas « le bot vient de répondre, sans rien attendre ». J'ai repris le principe et la durée de la
session (30 min d'inactivité) sous forme d'une fenêtre qui repart à chaque réponse du bot, plutôt qu'une fausse session
vide.

### La règle
- **Mode « mots-clés uniquement »** : après une réponse du bot (n'importe quel flux, l'IA ou une notification de
  commande), la conversation reste ouverte **30 min** (« Conversation ouverte après une réponse du bot » dans la fiche,
  de 1 à 720 min). Tous les messages du client vont alors au bot ou à l'IA, comme en mode « toujours ». La fenêtre
  repart à chaque réponse du bot.
- **Les pauses passent avant** : transfert, pause « l'équipe a répondu » et sa reprise de 10 min, main reprise.
- **Hors fenêtre** : comme avant, un mot-clé est nécessaire. Un ami du gérant à qui le bot n'a jamais parlé reste
  ignoré.
- **Technique** : la dernière réponse du bot est relue dans les messages enregistrés (aucune colonne ajoutée). Le
  simulateur applique la même règle.
- **Inchangé** : le mode « toujours » (Cookies) et le numéro PFlow (démos).

### Tests (`conversation-ouverte.test.ts`)
- le scénario exact de Mexico : le transfert part, et le transfert est enregistré ;
- une question 20 min après le lien : l'IA répond, et la fenêtre repart ;
- un message 40 min après : ignoré sans mot-clé, alors qu'un mot-clé marche toujours ;
- un délai de 5 min réglé dans la fiche ;
- un ami du gérant : ignoré ;
- une réponse de l'équipe pendant la fenêtre : silence, puis reprise au bout de 10 min ;
- Cookies : inchangé.
