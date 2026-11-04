# Guide d'onboarding — lancer le bot d'un nouveau resto, de A à Z

Pour quelqu'un qui n'a **jamais vu la plateforme**. Compter **30 à 45 minutes** par resto (hors
attente de Meta). Dernière mise à jour : 5 novembre 2026.

> ⚠️ **Étape C pas encore branchée** : tout fonctionne jusqu'au simulateur (étapes 1 à 6). La connexion
> WhatsApp réelle (étape 7) est prête dans le code mais pas activée ; elle est décrite ici telle
> qu'elle se fera.

---

## 0. Comment ça marche, en une minute

| Outil | Rôle | Adresse |
|---|---|---|
| **CRM PFlow Order** | La **source** : le resto, son mini-site de commande, ses horaires, zones, carte | (ton CRM habituel) |
| **PFlow Bots** | Le **bot** : ce qu'il répond, la fiche d'infos, le simulateur, la boîte de réception | pflow-bot-app.vercel.app |
| **Meta (WhatsApp / Instagram)** | Le **canal** : le numéro sur lequel les clients écrivent | business.facebook.com |

Principe : **un seul modèle maître** (l'Accueil, les Infos pratiques, la commande, l'IA…) est partagé par
tous les restos. Chaque resto a son **bot lié au modèle**, qui prend ses infos dans le CRM et dans sa
**fiche d'infos**. On ne réécrit donc pas un bot pour chaque client : on remplit sa fiche.

Règles à ne jamais oublier :
- Le bot **lit** le CRM, il ne le modifie jamais. Une info fausse qui vient du CRM se corrige **dans le CRM**.
- Le bot **n'envoie jamais de lien** dans ses textes libres : la commande passe toujours par le bouton
  « Commander » (mini-site PFlow Order).
- Tests uniquement sur le numéro de test Meta ou ton propre numéro. **On ne touche pas aux bots UChat
  en production.**

## 1. Prérequis (une seule fois)

- [ ] Un compte sur le **CRM** (même e-mail et mot de passe que pour PFlow Bots).
- [ ] Ce compte est **administrateur du bot** (ligne dans `bot_admins`, ajoutée par Jules). Sans ça,
      PFlow Bots affiche « Compte non autorisé ».
- [ ] Le **modèle maître** existe (page **Modèle maître**). S'il n'y en a pas, demander à Jules.

## 2. Étape 1 — Le resto dans le CRM (10 min)

Dans le CRM PFlow Order, ouvrir (ou créer) la fiche du resto et vérifier :

- [ ] **Statut** : « signé », « actif » ou « démo ». *Les autres statuts (prospect, perdu…) n'ont pas de bot.*
- [ ] **Slug du mini-site** (ex. `cookies-an-nou`) : sans lui, pas de bouton « Commander ».
- [ ] **Adresse**, **horaires d'ouverture**, **livraison** et/ou **retrait** cochés.
- [ ] **Zones de livraison** (avec les frais) si le resto livre.
- [ ] **Carte** : produits et catégories (le bot en fait un résumé pour l'IA, allergènes compris).
- [ ] **Fuseau horaire** (Guadeloupe ou Martinique) ; par défaut `America/Guadeloupe`.

Ces champs arrivent tels quels dans le bot et y sont **verrouillés** 🔒 (modifiables seulement dans le CRM).

## 3. Étape 2 — Le bot se crée tout seul (1 min)

1. Ouvrir **PFlow Bots** → se connecter → page **Clients**.
2. Le resto apparaît, avec son bot **déjà lié au modèle maître** (création automatique dès que le statut
   est signé / actif / démo).
3. Cliquer sur le resto pour ouvrir sa page.

Si le resto n'apparaît pas : vérifier le statut dans le CRM, puis recharger la page.
Si son bot a été **désactivé** auparavant, il n'est **jamais recréé automatiquement** : bouton
« Réactiver » sur sa carte.

## 4. Étape 3 — La fiche d'infos (10 à 15 min)

Page du resto → carte **Fiche d'infos**. Les champs 🔒 viennent du CRM. À remplir dans le bot :

| Champ | Exemple | Utilisé quand le client demande… |
|---|---|---|
| **Jours de livraison fixes par zone** | Jarry : mardi, mercredi, vendredi | « Vous livrez quand à Jarry ? » |
| **Tournées exceptionnelles** (datées) | Samedi 12 : Sainte-Anne | idem, en plus des jours fixes |
| **Points de vente** | Station Vito, Le Gosier | « Où vous trouver ? » |
| **Moyens de paiement** | Espèces, carte | « Je peux payer par carte ? » |
| **Précisions sur les horaires** | Fermé les jours fériés | « Vous êtes ouverts lundi ? » |
| **Questions fréquentes (pour l'IA)** | Q : Sans gluten ? R : Oui, les cookies avoine | questions libres (IA) |
| **Règles spéciales** | Commande la veille avant 18 h | l'IA les respecte |

Astuce : un champ vide **ne s'affiche pas** dans les messages (pas de titre orphelin).

## 5. Étape 4 — Les réglages du bot (2 min)

Page du resto → carte **Réglages** :

- **« Le bot répond… »**
  - **À tous les messages** : numéro dédié au bot (cas normal).
  - **Seulement aux mots-clés** : numéro **personnel** du gérant en **coexistence** (il garde son appli
    WhatsApp Business ; le bot ne répond qu'à « bonjour », « commander », « infos »… pour ne pas
    s'incruster dans ses conversations privées).
- **Fuseau horaire** : celui du resto.
- **Options payantes** (relance de panier, demande d'avis…) : seulement si le client les a prises.

## 6. Étape 5 — La liste de contrôle (2 min)

Sur la page **Clients**, la carte du resto montre une **liste de contrôle** :
- 🔴 **Erreur** : à corriger avant la mise en service (ex. « Pas de slug du mini-site »).
- 🟠 **Avertissement** : une variable utilisée par le bot est vide dans la fiche (ex. `{{points_de_vente}}`).
- 🔵 **Info** : pour comprendre (ex. « mode mots-clés uniquement : le flux par défaut ne se lance pas »).

Objectif : **zéro erreur**, et chaque avertissement compris.

## 7. Étape 6 — Le simulateur (10 min)

Menu → **Simulateur** → choisir le resto dans « Client à simuler ». C'est un faux WhatsApp : rien n'est
envoyé à personne. Dérouler ces scénarios et cocher :

- [ ] « **Bonjour** » → message d'accueil avec le nom du resto, bouton **Commander** (vers le bon mini-site), boutons.
- [ ] **Infos pratiques** → **Horaires** : horaires du CRM, ouvert / fermé correct à l'heure actuelle
      (l'horloge du simulateur peut être avancée pour tester un dimanche ou la nuit).
- [ ] **Infos pratiques** → **Livraison** : zones, jours fixes, tournées, points de vente.
- [ ] **Question libre** (« vous avez des cookies sans gluten ? ») → l'IA répond avec la fiche, **sans lien**,
      et propose le bouton Commander si le client veut commander.
- [ ] « **Je veux parler à quelqu'un** » → message de transfert, le bot se met en pause.
- [ ] « **✅ Commande n° 42 passée** » (texte du retour depuis le mini-site) → le bot ne relance rien.
- [ ] Un mot au hasard → réponse par défaut cohérente.

Le **journal** à droite montre ce que le bot a décidé et pourquoi (flux lancé, appel IA, coût).

## 8. Étape 7 — Connexion WhatsApp (étape C — pas encore active)

*Ce qui se fera quand l'étape C sera branchée (voir `docs/etape-c/plan.md` et `guide-meta.md`).*

1. **Choisir le numéro** avec le gérant :
   - **numéro dédié** (recommandé) : une puce ou un numéro fixe qui reçoit un SMS ou un appel ;
   - **son numéro WhatsApp Business actuel** en **coexistence** (il garde l'appli ; parcours par QR code).
2. **Ajouter le numéro chez Meta** (WhatsApp Manager), nom affiché validé par Meta.
3. **Relier le numéro au resto** dans PFlow Bots : le canal démarre en état **« test »** — le bot ne
   répond qu'aux **numéros de test** listés (le tien, celui du gérant).
4. **Tester en vrai** depuis ton téléphone : les mêmes scénarios qu'au simulateur, plus un vrai
   aller-retour avec le mini-site (« Commander » → commande → « Retour sur WhatsApp »).
5. Renseigner le **numéro d'alerte du gérant** (il est prévenu quand un client demande une personne).
6. Passer le canal en **« actif »** : le bot répond à tout le monde.

**Instagram** (facultatif, plus tard) : même principe avec le compte Instagram professionnel du resto
(section 9 du guide Meta).

## 9. Étape 8 — Après la mise en service

- **Boîte de réception** : toutes les conversations. **« Reprendre la main »** coupe le bot pour ce
  client ; **« Rendre au bot »** le relance. 🔔 = un client attend l'équipe. Une réponse n'est possible
  que dans les **24 h** qui suivent le dernier message du client (règle de Meta).
- Quand le gérant répond lui-même depuis son appli (coexistence), le bot **se tait** automatiquement
  pour ce client pendant quelques heures.
- **État du système** (menu du compte → « État ») : canaux actifs, derniers appels IA et leur coût,
  dernières erreurs.

## 10. Problèmes fréquents

| Symptôme | Cause probable | Solution |
|---|---|---|
| Le resto n'apparaît pas dans Clients | Statut CRM ≠ signé / actif / démo | Changer le statut dans le CRM, recharger |
| « Compte non autorisé » | Compte absent de `bot_admins` | Demander à Jules |
| Un champ 🔒 est faux | Il vient du CRM | Le corriger dans le CRM |
| Pas de bouton « Commander » | Slug du mini-site manquant | Le renseigner dans le CRM |
| L'IA répond « je transmets à l'équipe » | Clé IA absente, limite du jour atteinte, ou question hors fiche | Voir État du système ; compléter la FAQ |
| Le bot ne répond pas sur le numéro perso du gérant | Mode « mots-clés uniquement » | Normal : seuls les mots-clés déclenchent le bot |
| Le bot s'est tu pour un client | Pause (transfert, gérant qui a répondu, main reprise) | Boîte de réception → « Rendre au bot » |

## 11. Récapitulatif à cocher

- [ ] CRM : statut, slug, adresse, horaires, livraison / retrait, zones, carte, fuseau
- [ ] PFlow Bots : le resto est dans Clients, bot lié au modèle
- [ ] Fiche d'infos : jours de livraison, points de vente, paiement, FAQ, règles
- [ ] Réglages : « Le bot répond… » adapté au numéro
- [ ] Liste de contrôle : zéro erreur
- [ ] Simulateur : les 7 scénarios passent
- [ ] (Étape C) Numéro relié, état « test », essais réels, numéro d'alerte, puis « actif »
