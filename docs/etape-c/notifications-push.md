# Notifications push de la boîte de réception (iPhone, ordinateur)

Préparé le 9 novembre 2026, PR séparée construite sur la n° 6 (alertes). **SQL appliqué le 9 novembre 2026** (accord
de Jules). Rien dans le CRM. Aucun service payant : Web Push standard, clés VAPID.

**Depuis le 9 novembre 2026, c'est la SEULE voie d'alerte** : plus de WhatsApp vers le numéro d'alerte, plus de
modèle Meta, plus d'e-mail (`docs/etape-c/alertes-jules.md`).

## 1. Ce que ça fait

- Chaque alerte (« Je veux le mien », « Parler à Jules », question en plein parcours, transfert de l'assistant) part
  en notification sur les appareils abonnés : iPhone (app installée), ordinateur (Chrome, Safari, Edge, Firefox).
- La notification affiche le **motif** en titre, puis le **nom du contact** et un **extrait** du message.
  Exemple : « 🔔 Je veux le mien » / « Marc : « C'est combien par mois ? » ».
- **Toucher la notification ouvre la conversation** dans la boîte de réception (`/inbox?contact=…`). Sur téléphone,
  la page descend jusqu'à la conversation.
- Les notifications d'une même conversation se remplacent (une par conversation sur l'écran verrouillé).

## 2. Une seule voie : le push

`src/channels/core/alerts.ts` : la notification part vers tous les appareils abonnés. C'est tout : ni WhatsApp, ni
e-mail.
- Au moins un appareil atteint : « gérant prévenu », voie **push**.
- Sinon (aucun appareil, clés absentes, échec) : voie **aucune**. La conversation reste « 🔔 Attend l'équipe » dans la
  boîte de réception, et la page État affiche un **bandeau rouge** en haut.
- Le transfert garde `alerte_push` (`envoyee`, `echec`, `aucun_abonnement`, `non_configure`) et l'erreur.

Page **État** :
- encadré **« Notifications push »** : bouton « Activer les notifications », appareils abonnés (dernière
  notification, dernier échec, « Retirer »), bouton **« Envoyer une notification de test »** ;
- **bandeau rouge** en haut de la page : alertes non reçues, aucun appareil abonné ou clés absentes ;
- encadré **« Alertes au gérant »** : pour chaque alerte, « notification push » ou « NON REÇUE », avec la raison
  (« aucun appareil abonné », « push en échec », « push non configurée »).

Un appareil dont l'abonnement a expiré (réponse 404 ou 410 du service push, par exemple les notifications coupées) est
**supprimé automatiquement**. Une autre erreur est notée sur l'appareil (page État).

## 3. iPhone : conditions

- **iOS / iPadOS 16.4 ou plus.** Avant, Safari ne gère pas le push web.
- **Seulement depuis l'app ajoutée à l'écran d'accueil.** Dans un onglet Safari, `PushManager` n'existe pas ; la
  page affiche alors la marche à suivre.
- **Autorisation après un geste** : la demande ne peut partir que d'un toucher (le bouton « Activer les
  notifications »), jamais toute seule à l'ouverture.
- Chaque push affiche une notification (`userVisibleOnly`, obligatoire chez Safari) : le service worker en affiche
  toujours une.
- L'app installée a **son propre stockage** : il faut **se reconnecter une fois** dans l'app (le compte de Safari
  n'est pas repris).
- Les modes **Concentration** et les **Réglages → Notifications → PFlow Bots** de l'iPhone s'appliquent comme pour
  une app normale.

Sources (le 9 novembre 2026, la page de WebKit n'était pas joignable depuis la session de travail : les trois premiers
points sont vérifiés par des articles qui la citent ; à relire sur la page elle-même) :
- [WebKit : Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Daring Fireball (cite l'annonce : permission « in response to direct user interaction »)](https://daringfireball.net/linked/2023/02/16/web-push-web-apps-ios)
- [9to5Mac : nouveautés des web apps dans iOS 16.4](https://9to5mac.com/2023/02/16/iphone-web-app-new-features-ios-16-4/)
- [Apple Developer : Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

### Étapes exactes sur l'iPhone de Jules

1. Vérifier la version : **Réglages → Général → Informations → Version d'iOS** (16.4 ou plus).
2. Ouvrir **Safari** (pas Chrome) sur **https://pflow-bot-app.vercel.app/inbox**. Se connecter.
3. Toucher **Partager** (carré avec une flèche), puis **« Sur l'écran d'accueil »**. Vérifier que « Ouvrir comme
   app web » est activé, puis **Ajouter**.
4. Ouvrir **PFlow Bots depuis la nouvelle icône** de l'écran d'accueil (pas depuis Safari).
5. **Se reconnecter** (stockage propre à l'app).
6. Dans la boîte de réception, toucher **« 🔔 Activer les notifications »**, puis **Autoriser**.
7. Aller sur **État** (menu, ou https://pflow-bot-app.vercel.app/etat dans l'app) et toucher **« Envoyer une
   notification de test »**. Verrouiller l'iPhone : la notification arrive en quelques secondes.
8. Toucher la notification : l'app s'ouvre sur la boîte de réception.

En cas de refus par erreur : **Réglages → Notifications → PFlow Bots → Autoriser les notifications**, puis rouvrir
l'app.

Sur ordinateur, même bouton, depuis le navigateur. Rien à installer.

## 4. Les clés VAPID (Jules, dans Vercel uniquement)

Les clés **ne passent jamais** par le code, Git ou une conversation.

1. Sur ton ordinateur, dans le dossier du projet (ou n'importe où avec Node) :

   ```bash
   npx web-push generate-vapid-keys
   ```

   La commande affiche une **clé publique** et une **clé privée**. Ne les copie nulle part ailleurs que dans Vercel.
2. Vercel → projet **pflow-bot-app** → Settings → Environment Variables. Ajouter, en **Production** (et Preview si
   tu veux tester sur une prévisualisation) :

   | Variable | Valeur | Type |
   |---|---|---|
   | `VAPID_PUBLIC_KEY` | la clé publique | normale (elle n'est pas secrète, le navigateur la reçoit) |
   | `VAPID_PRIVATE_KEY` | la clé privée | **Sensitive** |
   | `VAPID_SUBJECT` | facultative : `mailto:…` ou adresse https | normale. **Absente** : `PFLOW_BOTS_PUBLIC_URL`, sinon `https://pflow-bot-app.vercel.app` |

3. **Redéployer** (Deployments → … → Redeploy) : les variables ne s'appliquent qu'au déploiement suivant.
4. Page État → « Clés détectées » : `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` « présente ».

Ne change pas les clés ensuite : tous les appareils abonnés devraient se réabonner. En cas de fuite de la clé privée :
nouvelles clés dans Vercel, puis sur chaque appareil « Désactiver » et « Activer ».

Sans clés : le bouton dit « Clés VAPID absentes », **aucune alerte ne part**. Elles restent visibles dans la boîte
de réception, et le bandeau rouge s'affiche sur la page État.

## 5. SQL (APPLIQUÉ le 9 novembre 2026, accord de Jules)

Fichier : `supabase/migrations/20261110000000_bot_push.sql`. Tables `bot_` uniquement ; aucune table ni donnée du
CRM touchée.

Résultat (9 novembre 2026) :
- table `bot_push_abonnements` créée, **RLS active**, politique « ses abonnements (admins du bot) » pour
  `authenticated`, 0 ligne ;
- contraintes : clé primaire, `endpoint` unique, `user_id` lié à `auth.users` (suppression en cascade) ;
- colonne `alerte_push` (text) sur `bot_transferts`, avec sa contrainte ; RLS toujours active ; les 3 transferts
  existants sont intacts (`alerte_push` vide) ;
- conseiller de sécurité Supabase : aucune alerte sur la nouvelle table.

```sql
-- 1. Les abonnements push (un par appareil et par navigateur) des administrateurs du bot.
create table if not exists public.bot_push_abonnements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  appareil text,
  cree_le timestamptz not null default now(),
  dernier_envoi_le timestamptz,
  dernier_echec_le timestamptz,
  dernier_echec text
);
create index if not exists bot_push_abonnements_user_idx on public.bot_push_abonnements (user_id);

-- RLS : seul un administrateur du bot voit et gère SES abonnements ; le serveur (service_role) envoie.
alter table public.bot_push_abonnements enable row level security;
create policy "bot_push_abonnements : ses abonnements (admins du bot)" on public.bot_push_abonnements
  for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.bot_admins where user_id = auth.uid()));

-- 2. La voie push de chaque alerte (page État).
alter table public.bot_transferts
  add column if not exists alerte_push text
    constraint bot_transferts_alerte_push_check check (alerte_push in ('envoyee', 'echec', 'aucun_abonnement', 'non_configure'));
comment on column public.bot_transferts.alerte_push is 'Notification push de l''alerte : envoyee (au moins un appareil), echec, aucun_abonnement ou non_configure (clés VAPID absentes)';
```

`p256dh` et `auth` sont les clés **publiques** du navigateur (elles servent à chiffrer la notification pour cet
appareil). Ce ne sont pas des secrets du serveur. Le contenu des notifications est **chiffré de bout en bout** : le
service push d'Apple ou de Google ne le lit pas.

## 6. Sécurité

- Routes `/api/push` (liste, abonnement, retrait) et `/api/push/test` : **administrateur du bot connecté**
  (`checkBotAdmin`), limite de débit, abonnements validés (adresse https, clés au bon format). Au plus 10 appareils par
  compte. Un appareil ne se retire que sur son propre compte.
- La notification de test ne vise **que les appareils du compte connecté** : aucun client, aucun canal touché.
- Publics, **sans aucune donnée** : `manifest.webmanifest`, `sw.js`, `icons/`, `apple-icon.png`.
- Le service worker n'ouvre que des pages du site (jamais un autre domaine). Il ne met aucune page en cache.

## 7. Tests

`src/channels/core/__tests__/push.test.ts`. Aucun vrai service push : les clés VAPID sont générées pour le
test.
- **Vrai chiffrement Web Push** : la requête est construite par `web-push` (aes128gcm, signature VAPID, urgence haute,
  durée 24 h). Le test la **déchiffre comme l'iPhone** et retrouve exactement la notification.
- Abonnement expiré (410) supprimé ; autre erreur notée ; un compte ne vise que ses appareils.
- De bout en bout : « Je veux le mien » sur PFlow Démo, puis notification qui ouvre la bonne conversation ; transfert
  noté « push envoyée », gérant prévenu sans WhatsApp. Les tests des alertes elles-mêmes (push seul, aucun envoi
  WhatsApp ni e-mail) sont dans `alerts.test.ts`.
- Routes : sans clés, 503 ; abonnements invalides refusés ; liste ; test (échec noté sur l'appareil) ; retrait. La
  clé privée n'apparaît jamais dans les réponses.

Vérifié aussi dans un navigateur (build de production, mode démo) :
- `manifest.webmanifest`, `sw.js` et les icônes servis sans mot de passe ; balises « écran d'accueil » présentes ;
- bouton « Activer les notifications » ;
- sur iPhone dans Safari, la marche à suivre « Sur l'écran d'accueil » ;
- `/inbox?contact=…` et le message du service worker ouvrent la conversation ;
- menu lisible sur téléphone.
