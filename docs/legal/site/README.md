# Pages légales pour pflow.fr — prêtes à mettre en ligne (non publiées)

Préparées le 7 novembre 2026 à partir de `docs/legal/politique-confidentialite.md`, avec **le gabarit exact
du site** (dépôt `Site-PFlow`, fichier `confidentialite.html` actuel : mêmes polices, couleurs, en-tête,
pied de page). Rien n'a été publié ni poussé sur le dépôt du site.

| Fichier | Où le mettre dans `Site-PFlow` | Adresse en ligne |
|---|---|---|
| `confidentialite.html` | **remplace** `confidentialite.html` (à la racine) | https://www.pflow.fr/confidentialite |
| `suppression-donnees.html` | **nouveau** fichier à la racine | https://www.pflow.fr/suppression-donnees |

Le site a `cleanUrls: true` : les adresses sans `.html` marchent toutes seules.

## Tes informations (SIRET, adresse…)

**Rien à compléter à la main.** Les deux pages lisent `infos-legales.js` (déjà rempli dans le dépôt du site :
Jules Pauwels, entrepreneur individuel, 615 Rue de l'aviation, Saint-Félix, Gosier, 97190, SIRET 10252446900016,
jules.pauwels2@gmail.com). Vérifié dans un navigateur : aucune case jaune « à compléter » ne reste.
À vérifier toi-même : que ces informations sont toujours exactes (elles sont publiques sur le site).

## Ce qui change par rapport à la page actuelle

L'actuelle `pflow.fr/confidentialite` (1er octobre) est périmée : elle ne parle pas des assistants
PFlow Bots, ni d'Anthropic (Claude), ni des démos par mot-clé, ni de la suppression des données.
La nouvelle version garde tout ce qui était juste (site, cookies, prospects, clients, durées légales) et ajoute :
- les deux rôles (sous-traitant pour les clients des restos, responsable pour les prospects) ;
- les assistants WhatsApp et Instagram (données, vocaux transcrits sans garder l'audio, consentement « STOP ») ;
- le compte Instagram @pflow.gp (mots-clés), repris de `order.pflow.fr/politique-de-confidentialite` ;
- l'IA (Claude), pas de décision automatisée, possibilité de parler à une personne ;
- sous-traitants à jour (Meta, Anthropic, Supabase UE, Vercel, transcription, Stripe/SumUp, UChat et OpenAI
  tant qu'UChat sert encore, Uber Direct) et transferts hors UE ;
- durées (12 mois pour les conversations…), sécurité ;
- **une section « Supprimer vos données » (`#suppression`) et un résumé en anglais** (Meta examine en anglais).

## Points à vérifier avant publication

1. **Suppression sous 30 jours** : il n'y a pas de bouton automatique. C'est toi qui effaces à la main sur
   demande (dans le CRM et, pour les conversations des bots, dans les tables `bot_` — je peux préparer un
   petit outil d'effacement par numéro si tu veux).
2. **« SUPPRIMER » sur Instagram** : déjà géré par le CRM pour @pflow.gp (tâche + notification). Je n'ai
   **pas** proposé « SUPPRIMER » sur WhatsApp : le bot ne le traite pas.
3. **Purge à 12 mois** : active depuis le 7 novembre 2026 (tâche quotidienne Vercel Cron, une fois
   `CRON_SECRET` défini dans Vercel).
3 bis. **Conversations avec @pflow.gp** : la page disait « 12 mois après le dernier message », mais le CRM
   ne les supprime pas automatiquement (`qg_motcle_messages`, aucune tâche de suppression). Phrase alignée
   sur la règle des prospects (3 ans après le dernier échange, comme l'ancienne page). Pour revenir à
   12 mois, il faudrait une suppression côté CRM (à décider par Jules).
4. **Ton autre app Meta** (mots-clés Instagram) utilise `order.pflow.fr/politique-de-confidentialite`.
   La nouvelle page couvre aussi ce cas : tu pourras plus tard faire pointer les deux apps vers
   `pflow.fr/confidentialite`. Je ne touche à rien de ce côté.
5. Facultatif : ajouter `https://www.pflow.fr/suppression-donnees` à `sitemap.xml`.
