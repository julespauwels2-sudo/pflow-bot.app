# Checklist C0 — tout avoir prêt avant la partie Meta

À lire **avant** de suivre le [guide Meta](guide-meta.md). Dans l'ordre. Rédigé le 5 novembre 2026.

**Temps total estimé : 1 h à 1 h 15 le jour J**, plus quelques jours d'attente pour la vérification
d'entreprise (à lancer en avance, voir A).

---

## A. Quelques jours avant (ce qui prend du temps chez Meta ou ailleurs)

- [ ] **Politique de confidentialité en ligne** (Meta demande son adresse dans les réglages de l'app).
      Relire et compléter `docs/legal/politique-confidentialite.md`, la publier sur pflow.fr
      (ex. `pflow.fr/confidentialite`). *30 min de relecture + publication.*
- [ ] **Site pflow.fr accessible**, avec le nom PFlow et un moyen de contact : Meta s'en sert pour la
      vérification d'entreprise.
- [ ] **Adresse e-mail professionnelle** sur le domaine (ex. contact@pflow.fr) : utile pour la
      vérification d'entreprise (Meta peut envoyer un code à une adresse du domaine).
- [ ] **Documents de l'entreprise** sous forme de fichiers PDF ou photos lisibles :
  - avis de situation au répertoire SIRENE (ou extrait d'immatriculation) au nom de la micro-entreprise ;
  - un justificatif d'adresse professionnelle (facture, attestation) au même nom et à la même adresse ;
  - ta pièce d'identité (Meta peut la demander pour l'administrateur).
- [ ] *(Facultatif mais conseillé)* **Lancer la vérification d'entreprise** dès que le portefeuille
      d'entreprise existe (étape C.2) : inutile pour le numéro de test, indispensable pour les vrais
      numéros (étape C6), et elle peut prendre plusieurs jours, avec parfois des allers-retours.

## B. Les accès à vérifier (10 min, la veille)

- [ ] **Compte Facebook personnel** : tu connais le mot de passe, et la **double authentification** est
      active (application d'authentification de préférence au SMS).
- [ ] **Portefeuille d'entreprise PFlow** sur business.facebook.com : tu en es administrateur. S'il
      n'existe pas, il sera créé le jour J (5 min).
- [ ] **Vercel** : tu peux te connecter et ouvrir le projet **pflow-bot-app** → Settings → Environment
      Variables (il faut pouvoir ajouter des variables et relancer un déploiement).
- [ ] **PFlow Bots** : tu peux te connecter (pour vérifier la page **État** à la fin).
- [ ] Pas besoin de Supabase pour C0 (la migration C et la clé `service_role` viennent en C1, avec moi).

## C. Le matériel (le jour J)

- [ ] **Un ordinateur** (les écrans de Meta pour développeurs sont pénibles sur téléphone).
- [ ] **Ton téléphone avec WhatsApp**, sur ton numéro personnel : c'est le numéro qui recevra les messages
      du numéro de test. ⚠️ Pas un numéro qui sert à un bot UChat en production, ni le numéro d'un resto.
- [ ] *(Facultatif)* **Un deuxième numéro WhatsApp** (un proche) pour jouer un deuxième client pendant les
      tests (le numéro de test peut écrire à 5 numéros confirmés au maximum).
- [ ] Pas besoin de carte bancaire pour C0 : le numéro de test et les messages de service sont gratuits.
      (Le moyen de paiement chez Meta viendra avec les vrais numéros, en C6.)
- [ ] Pas besoin de puce ni de nouveau numéro pour C0 (le numéro dédié d'un resto, c'est C6).

## D. À préparer avant de commencer (5 min)

- [ ] **La phrase de vérification du webhook** (`WHATSAPP_VERIFY_TOKEN`) : 32 caractères ou plus, au hasard
      (générateur de mots de passe). Elle ira **seulement** dans Vercel.
- [ ] Un endroit pour noter les **deux identifiants non secrets** que tu me donneras : *Phone number ID*
      et *WhatsApp Business Account ID*.
- [ ] Rappel : le **token**, la **clé secrète de l'app** et la **phrase** ne vont **que dans Vercel**.
      Jamais dans une conversation, un e-mail, une note ou Git.

## E. Le déroulé du jour J (≈ 1 h)

| # | Étape (détails dans le guide Meta) | Temps |
|---|---|---|
| 1 | Se connecter à business.facebook.com, créer le portefeuille PFlow si besoin, lancer la vérification d'entreprise si pas encore fait | 10–20 min |
| 2 | Créer l'app **PFlow Bots** (guide § 1) | 5 min |
| 3 | Numéro de test : ajouter ton numéro, recevoir « hello_world », **répondre « Bonjour »** (guide § 2) | 5 min |
| 4 | Clé secrète de l'app → Vercel `WHATSAPP_APP_SECRET` ; renseigner l'adresse de la politique de confidentialité (guide § 3) | 5 min |
| 5 | Utilisateur système + **token permanent** → Vercel `WHATSAPP_TOKEN` (guide § 4) | 10–15 min |
| 6 | Phrase de vérification → Vercel `WHATSAPP_VERIFY_TOKEN` (guide § 5) | 2 min |
| 7 | Vercel → **Redeploy** du dernier déploiement (les variables ne s'appliquent qu'après) | 3 min |
| 8 | PFlow Bots → **État** : les 3 clés WhatsApp « présente » ; le webhook reste **« inactif »** (il manque `SUPABASE_SERVICE_ROLE_KEY`, c'est normal et voulu jusqu'à C1) | 2 min |
| 9 | M'envoyer le *Phone number ID* et le *WABA ID* | 1 min |

**Ne pas faire en C0** : brancher le webhook chez Meta (guide § 6, ce sera en C1 avec moi), passer l'app
en « Live » (§ 7), ajouter un vrai numéro (§ 8), toucher aux bots UChat.

**Pourquoi c'est sans risque** : tant que la migration C n'est pas appliquée et que
`SUPABASE_SERVICE_ROLE_KEY` n'est pas dans Vercel, le webhook répond « canal non configuré » et
n'envoie rien, même avec les trois variables WhatsApp en place.

## F. Ce que tu me donnes à la fin

| Donnée | Secret ? | Où |
|---|---|---|
| Phone number ID du numéro de test | Non | Dans la conversation |
| WhatsApp Business Account ID (WABA ID) | Non | Dans la conversation |
| Ton numéro WhatsApp confirmé comme destinataire de test | Non | Dans la conversation |
| `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | **Oui** | **Vercel uniquement** |
| Où en est la vérification d'entreprise | Non | Dans la conversation |

## G. Ensuite (C1, ensemble)

Je te montre le SQL de la migration C, tu valides, on l'applique ; tu ajoutes `SUPABASE_SERVICE_ROLE_KEY`
dans Vercel ; on branche le webhook chez Meta ; premier message de ton téléphone au numéro de test →
réponse du bot.

**Instagram** n'est pas dans C0. Pour plus tard : un compte Instagram **professionnel** et la section 9
du guide Meta.
