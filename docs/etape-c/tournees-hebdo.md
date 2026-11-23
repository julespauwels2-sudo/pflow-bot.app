# Tournées récurrentes (Cookies An Nou, 22 novembre 2026)

## Ce que fait la PR
- **Fiche du resto, bloc Livraison** : « Planning hebdomadaire de tournées », du lundi au dimanche. Un ou plusieurs lieux
  par jour, avec un créneau pré-rempli par les horaires du CRM (mardi au vendredi 8 h – 12 h pour Cookies).
- **Exceptions** : les tournées datées existantes, avec une case « Annulée ». Une tournée non annulée est un passage
  ajouté ; une tournée annulée retire le passage de ce lieu ce jour-là (lieu « * » : toute la journée).
- **Calcul des passages** (14 prochains jours) : planning, plus les ajouts, moins les annulations. L'IA reçoit le
  planning de la semaine et ces prochains passages, avec les règles déjà en place : répondre seule, transférer si le
  lieu n'y est pas ou si le client veut une confirmation précise. « Infos pratiques » affiche les mêmes passages.
- **Jours fériés** : le CRM n'en connaît pas. On les saisit en exception « toute la journée ».
- **Sans planning hebdomadaire** (Mexico, AG Pizza, autres restos) : rien ne change. Testé.

## Stockage partagé avec le CRM
- Nouvelle table `bot_tournees_hebdo`.
- Colonne `annulee` dans `bot_tournees`.
- Règle d'accès « son resto » avec `a_acces()` du CRM.

Fichier : `supabase/migrations/20261122000000_bot_tournees_hebdo.sql`, **non appliqué**. Spécification pour le CRM :
`spec-crm-tournees-hebdo.md`. Tant que la migration n'est pas appliquée, le bot fonctionne comme avant : le planning
n'est ni lu ni enregistré.

## Après accord
1. Appliquer la migration.
2. Saisir le planning de Leslie dans la fiche de Cookies (bots.pflow.fr) avec les vrais lieux.
3. Vérifier dans le simulateur, avec « IA réelle », les questions « Vous passez quand à Jarry ? » et « Vous passez où
   demain ? ».
