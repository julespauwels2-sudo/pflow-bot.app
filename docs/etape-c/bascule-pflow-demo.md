# Bascule de PFlow Démo (+590 691 26 68 53) comme numéro PFlow des démos

Préparé le 8 novembre 2026 d'après le diagnostic de Jules. **Cas A, en coexistence.** Rien n'a été fait
chez Meta ; le SQL de la partie 4 attend l'accord de Jules.

| Élément | Valeur |
|---|---|
| Compte WhatsApp (écran Paramètres) | `1808772226929443`. L'API le refuse (« Invalid WhatsApp account usage », 2388339) : normal avec le nouveau modèle de comptes |
| Compte de messagerie (« Application WhatsApp Business », AED, partenaire Smart Link) | `4170754433058228`. **C'est l'ID qui marche dans l'API** (comme `1511…` pour le numéro de test) |
| Numéro | ID `1284474614757490`, +590 691266853, `CLOUD_API`, `is_on_biz_app: true` (coexistence) |

## 1. Attribuer les éléments à `pflow-bots-serveur`

Paramètres de l'entreprise (PFlow 1) → Utilisateurs → Utilisateurs système → **pflow-bots-serveur** →
**Attribuer des éléments** :
- **Comptes WhatsApp** → `1808772226929443` → **Contrôle total** ;
- le **compte de messagerie** `4170754433058228` (« Application WhatsApp Business ») → **Contrôle total**.

**Pas besoin de régénérer le token** : son étendue est « Applies to all objects » (tous les éléments
attribués à l'utilisateur système), comme pour le numéro de test, qui a marché sans nouveau token après
l'attribution. Si le test d'accès (partie 2) refuse quand même un compte, régénère alors le token (mêmes
autorisations, expiration Jamais), mets-le dans `WHATSAPP_TOKEN` et redéploie.

## 2. Abonner PFlow Bots, et vérifier (sans afficher de token)

Il y a deux façons de faire. **La plus simple : la page État**, avec le token du serveur (jamais affiché).
1. Joue d'abord le SQL de la partie 4 : le canal est créé **en test**.
2. Page **État → Canaux** → PFlow Démo → **Abonner PFlow Bots** (confirmation). Ça fait
   `POST 4170754433058228/subscribed_apps` avec le token de `pflow-bots-serveur`, donc pour l'app PFlow Bots.
3. Page **État → Tester l'accès du token** : la ligne « Apps abonnées (webhook) » doit citer **PFlow Bots**,
   « via le compte de messagerie ». Les lignes « Numéro » et « Compte de messagerie » doivent être OK.

L'autre façon, l'explorateur de l'API Graph (app PFlow Bots) : `POST 4170754433058228/subscribed_apps`
(réponse `{"success": true}`), puis `GET 4170754433058228/subscribed_apps`. Ton erreur « code 1,
sous-code 99 » sur le GET venait probablement du token utilisateur, qui n'a pas encore les droits sur ce
compte (le compte n'était attribué qu'à Smart Link). Le bouton de la page État évite ce cas.

**Retour arrière** : bouton **Désabonner** (même endroit), qui fait `DELETE …/subscribed_apps`.

## 3. Éviter la double réponse (UChat via Smart Link + PFlow Bots)

| Option | Effet | Réversible ? |
|---|---|---|
| Retirer le partenaire **Smart Link** | UChat perd tout accès au compte (messages, envois, historique) | **Difficile** : il faudrait refaire la connexion côté UChat |
| **Désactiver le bot UChat** de ce numéro (UChat garde l'accès) | UChat ne répond plus ; la conversation reste visible dans UChat | **Oui, en un clic** |
| Pendant le test seulement : **mettre en pause le bot UChat pour ton propre contact** (UChat → Live Chat → ta conversation → reprise humaine / pause de l'automatisation) | Seul PFlow Bots te répond ; les prospects gardent UChat | Oui |

**Recommandation, la plus sûre et réversible :**
- **Pendant le test** (canal en « test ») : pause d'UChat **pour ton contact seulement**. Les prospects continuent
  d'avoir UChat, PFlow Bots ne répond qu'à toi.
- **À la bascule** (canal en « actif ») : **désactiver le bot UChat** de ce numéro, sans retirer Smart Link.
- **Retour arrière** : canal → « Repasser en test » (page État), puis réactiver le bot UChat.
- Retirer Smart Link seulement plus tard, quand plus aucun numéro ne passe par UChat.

## 4. Le canal (SQL, à valider avant de l'appliquer)

```sql
insert into public.bot_canaux
  (restaurant_id, role, plateforme, compte_id, waba_id, messaging_account_id, numero_affiche,
   mode_declenchement, coexistence, tel_alerte, etat, test_numeros)
values
  (null, 'pflow', 'whatsapp', '1284474614757490', '1808772226929443', '4170754433058228',
   '+590 691 26 68 53 (PFlow Démo)', 'toujours', true, '590690938108', 'test', array['590690938108']);
```

- `role 'pflow'` : le numéro des démos (aucun resto). Il ne reçoit jamais d'événement de commande, et le
  bouton « Commander » ouvre la page de **démonstration** du CRM.
- `toujours` : le bot répond à tout message (bot PFlow de base sans mot-clé).
- `coexistence true` : la pause de 12 h quand tu écris depuis l'appli.
- `test` : il ne répond qu'à ton numéro perso. On passe en « actif » après le test.

## 5. Le test (≈ 15 min)

Prérequis : champ **`smb_message_echoes`** abonné dans l'app PFlow Bots (WhatsApp → Configuration →
Champs du webhook). Sans lui, tes messages envoyés depuis l'appli n'arrivent pas au bot, et il ne se tait
pas. Démos en cours (jusqu'au 12 novembre) : **« Gwada food »** et **« Gwada Smash Burger »** (page
Démos : Prolonger si besoin).

1. Depuis **ton numéro perso**, écris à PFlow Démo : **« Bonjour »**. Le **bot PFlow de base** répond.
2. Écris **« Gwada food »** : la **démo** démarre (Accueil de Gwada food). Le bouton « Commander » ouvre la
   page de démonstration ; rien n'est commandé pour de vrai.
3. Pose une question (« vous livrez où ? ») : l'IA de la démo répond.
4. **Depuis l'appli WhatsApp Business** du téléphone de PFlow Démo, réponds à ton numéro perso. Puis, depuis
   ton numéro perso, écris « Bonjour » : **le bot ne répond pas** (pause de 12 h, « le gérant a répondu »).
   Pour lever la pause : PFlow Bots → **Boîte de réception** → ta conversation → **Rendre au bot**.
5. Page État → derniers événements : tes messages, et ceux que tu as envoyés depuis l'appli (« echo »).
6. Si tout est bon : désactive le bot UChat de ce numéro, puis page État → **Passer en actif**. Fais écrire
   un ami (un « vrai » prospect) : bot de base, puis mot-clé de démo.

## Devise AED du compte de messagerie

- **Inutile de la changer pour l'instant.** Le bot n'envoie que des réponses dans les 24 h (pas de modèles
  marketing), et la devise ne change que l'affichage et la facturation des messages payants.
- **D'après la documentation de Meta, la devise d'un compte existant ne se change pas.** Il faudrait créer un
  nouveau compte (Meta mentionne aussi une API de migration de devise, à confirmer). Ma session n'arrive pas à
  ouvrir le site de Meta : à vérifier de ton côté.
- **À vérifier** : WhatsApp Manager → compte de messagerie → **Paramètres de paiement**. Qui paie : une ligne de
  crédit de **Smart Link** (donc UChat) ou ton moyen de paiement ? Et les messages de service (réponses dans
  les 24 h) sont-ils facturés en novembre 2026 ? Des sources tierces annoncent un changement au 1er octobre
  2026. Si une ligne de crédit Smart Link paie, les messages envoyés par PFlow Bots lui seraient facturés :
  à régler avec UChat avant la bascule.
