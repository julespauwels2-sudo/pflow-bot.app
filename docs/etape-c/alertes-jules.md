# Alertes à Jules (et aux gérants) : fiables même fenêtre de 24 h fermée

Préparé le 9 novembre 2026. **Rien n'a été créé chez Meta** : à faire par Jules, après accord.

## 1. Aujourd'hui (avant la PR)

- Les alertes (« Je veux le mien », « Parler à Jules », question en plein parcours, transfert IA) partent **du
  numéro du canal** (pour la démo : **PFlow Démo, +590 691 26 68 53**) vers `bot_canaux.tel_alerte` (**590690938108**).
- C'est un **message libre** (texte). Meta ne l'accepte que si le destinataire a écrit à ce numéro dans les
  **24 dernières heures**. Sinon : erreur 131047 (« Re-engagement message »). Le transfert est quand même noté
  (`gerant_prevenu = false`), mais **personne n'est prévenu**.
- En test, ça marche : Jules écrit lui-même au bot. **En production, la fenêtre sera presque toujours fermée.**

## 2. Après la PR

Dans l'ordre (`src/channels/core/alerts.ts`) :

1. **Message libre**, seulement si la fenêtre de 24 h du destinataire est ouverte. On le sait parce qu'il a écrit au
   canal récemment, avec une marge de 10 min.
2. Sinon, ou en cas d'échec : **modèle approuvé** par Meta, de catégorie « Utilitaire » (partie 3).
3. Si WhatsApp échoue : **e-mail de secours** à `ALERTE_EMAIL` (partie 4).
4. La voie utilisée et les erreurs sont gardées **avec le transfert**. Elles sont affichées sur la **page État**,
   encadré « Alertes au gérant » : dernières alertes, voie, erreurs, et un bandeau rouge s'il y a des alertes non
   reçues.

## 3. Le modèle WhatsApp (à créer par Jules, après accord)

| Champ | Valeur |
|---|---|
| Nom | `alerte_conversation` |
| Catégorie | **Utilitaire** (*Utility*) |
| Langue | Français (`fr`) |
| Compte | le compte WhatsApp de PFlow Démo (et plus tard celui de chaque resto) |

**Corps** (4 variables) :

```
🔔 PFlow Bots : {{1}} attend une réponse sur {{2}}.
Motif : {{3}}
Dernier message : « {{4}} »
Répondez depuis la boîte de réception PFlow Bots.
```

**Bouton** (facultatif, recommandé) : « Visiter le site web », texte **Ouvrir la boîte de réception**, URL fixe
`https://pflow-bot-app.vercel.app/inbox`.

**Exemples à donner à Meta** (obligatoires) :
- `{{1}}` = `Marc (+590690111111)`
- `{{2}}` = `+590 691 26 68 53 (PFlow Démo)`
- `{{3}}` = `Je veux le mien`
- `{{4}}` = `C'est payant ?`

Règles respectées par le code : chaque variable tient sur **une ligne** (pas de retour à la ligne ni de
tabulation), est bornée en longueur (80 / 60 / 60 / 200 caractères), et n'est jamais vide (« — »). Le modèle ne
commence ni ne finit par une variable.

**Étapes chez Meta** (business.facebook.com → WhatsApp Manager) :
1. Compte WhatsApp de PFlow Démo → **Modèles de message** → **Créer un modèle**.
2. Catégorie **Utilitaire**, nom `alerte_conversation`, langue **Français**.
3. Coller le corps ci-dessus, avec les variables `{{1}}` à `{{4}}`. Ajouter le bouton (facultatif). Remplir les exemples.
4. Envoyer pour examen : la réponse arrive en général en quelques minutes, au plus 24 h.
5. Une fois le modèle **approuvé**, dans Vercel (projet pflow-bot-app) : `WHATSAPP_ALERTE_MODELE = alerte_conversation`
   (et `WHATSAPP_ALERTE_LANGUE = fr` si besoin, c'est la valeur par défaut). Puis redéployer.
6. Test : laisser passer 24 h sans écrire au numéro PFlow Démo depuis 590690938108 (ou utiliser un autre numéro
   d'alerte), puis déclencher « Je veux le mien » depuis un numéro de test. Page État → « Alertes au gérant » :
   **WhatsApp (modèle)**.

Si Meta range le modèle en « Marketing », il reste utilisable, mais il coûte plus cher (environ 0,07 à 0,09 € par
envoi). Il faudra alors demander une révision.

**Coût approximatif** (tarifs Meta par message, novembre 2026, à vérifier sur la page des tarifs de Meta) : modèle
utilitaire vers un numéro **France** ≈ **0,025 à 0,03 €** par alerte. Le compte de messagerie est en **AED** : environ
0,10 à 0,12 AED, plus les frais de change de la banque. Un numéro +590 (Guadeloupe) peut être classé ailleurs que
« France » dans la grille de Meta : vérifier dans WhatsApp Manager → Facturation, ou sur la première facture.
Depuis le 1er octobre 2026, les messages libres dans la fenêtre de 24 h sont aussi payants. À environ 10 alertes par
jour, cela fait moins de 10 € par mois.

## 4. L'e-mail de secours

- Le CRM n'envoie aucun e-mail aujourd'hui. PFlow Bots utilise **Resend** (API HTTP, sans dépendance). Offre
  gratuite : 3 000 e-mails par mois. Sans domaine vérifié, Resend n'envoie **qu'à l'adresse du compte Resend** :
  c'est justement le cas ici.
- Étapes Jules :
  1. Créer un compte sur resend.com avec **jules.pauwels2@gmail.com** ;
  2. Créer une clé API (droit « Sending access ») ;
  3. Dans Vercel (pflow-bot-app), ajouter `RESEND_API_KEY` = la clé (variable « Sensitive ») et
     `ALERTE_EMAIL = jules.pauwels2@gmail.com`. Ne jamais coller la clé ailleurs.
  4. Facultatif, plus tard : vérifier le domaine pflow.fr chez Resend, puis `ALERTE_EMAIL_FROM = PFlow Bots <alertes@pflow.fr>`.
     Par défaut, l'expéditeur est `PFlow Bots <onboarding@resend.dev>`.
- Objet : « 🔔 PFlow Bots : <motif> (<nom du contact>) ». Le corps reprend le texte de l'alerte.

## 5. SQL (à valider, NON appliqué)

Fichier `supabase/migrations/20261109000000_bot_transferts_alerte.sql` : deux colonnes sur la table **bot_**
`bot_transferts` (aucune table du CRM touchée ; RLS déjà active, inchangée).

```sql
alter table public.bot_transferts
  add column if not exists alerte_voie text
    constraint bot_transferts_alerte_voie_check check (alerte_voie in ('texte', 'modele', 'email', 'aucune')),
  add column if not exists alerte_erreur text;
```

**Sans cette migration**, le code enregistre les transferts comme avant, sans ces deux colonnes. La page État montre
alors seulement « envoyée » ou « non envoyée » (`gerant_prevenu`), sans la voie ni l'erreur.

## 6. Variables Vercel (pflow-bot-app)

| Variable | Rôle | État |
|---|---|---|
| `WHATSAPP_ALERTE_MODELE` | nom du modèle approuvé | à ajouter **après** l'approbation de Meta |
| `WHATSAPP_ALERTE_LANGUE` | langue du modèle | facultatif (`fr` par défaut) |
| `RESEND_API_KEY` | e-mail de secours | à créer (Resend) |
| `ALERTE_EMAIL` | adresse de l'e-mail de secours | `jules.pauwels2@gmail.com` |
| `ALERTE_EMAIL_FROM` | expéditeur | facultatif |

**Blocage de l'actif** : pas de passage en actif de PFlow Démo tant que le modèle n'est pas approuvé et
`WHATSAPP_ALERTE_MODELE` défini, ou au moins l'e-mail de secours en place.
