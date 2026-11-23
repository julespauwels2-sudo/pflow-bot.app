# Spécification pour le CRM : planning hebdomadaire des tournées (22 novembre 2026)

Objectif : la gérante (ex. Leslie, Cookies An Nou) modifie depuis le CRM le même planning que PFlow Bots. Les deux
lisent et écrivent les mêmes lignes, dans le même projet Supabase.

## Où sont les données
- **`bot_tournees_hebdo`** : le planning de chaque semaine (migration `supabase/migrations/20261122000000_bot_tournees_hebdo.sql`
  de pflow-bot.app, à appliquer après accord de Jules). Une ligne par lieu et par jour :
  | colonne | type | sens |
  |---|---|---|
  | `id` | uuid | clé (générée) |
  | `restaurant_id` | uuid | le resto (`restaurants.id`) |
  | `jour` | 1 à 7 | jour ISO (1 = lundi … 7 = dimanche) |
  | `lieux` | texte, 1 à 300 caractères | zone ou entreprise(s), ex. « Jarry — zone industrielle » |
  | `de`, `a` | heure ou null | créneau ; à pré-remplir avec `restaurants.horaires` (ex. 08:00 – 12:00) |
  | `ordre` | entier | ordre d'affichage dans la journée |
  | `cree_le`, `maj_le` | horodatages | `maj_le` à mettre à jour à chaque modification |
- **`bot_tournees`** (existante) : les exceptions datées.
  - `annulee = false` : passage ajouté ce jour-là (`date`, `de`, `a`, `lieux`).
  - `annulee = true` : passage du planning annulé ce jour-là. `lieux` = le lieu annulé (même texte que dans le
    planning, sans tenir compte des majuscules ni des accents), ou `*` pour toute la journée (jour férié, congé).

## Droits
Règle d'accès « son resto » : `public.a_acces(restaurant_id)`, la fonction déjà utilisée par le CRM. La gérante lit et
écrit seulement les lignes de son resto, avec sa session (clé publique + connexion), sans clé de service. Les
administrateurs du bot gardent l'accès complet.

## Ce que le CRM doit faire
1. **Écran « Mes tournées »** (dashboard du resto, si la livraison est activée) :
   - le planning hebdomadaire, du lundi au dimanche ;
   - un ou plusieurs lieux par jour, chacun avec un créneau pré-rempli par les horaires du jour.
2. **Exceptions** :
   - « Annuler un passage » (date + lieu, ou toute la journée) ;
   - « Ajouter une tournée » (date, créneau, lieu) ;
   - les exceptions passées peuvent être masquées.
3. **Écriture** : `insert`, `update` (avec `maj_le = now()`) et `delete` directement dans ces deux tables, avec le client
   Supabase de l'utilisateur. Pas de suppression en masse sans confirmation.
4. **Ne pas toucher** aux autres colonnes ni aux autres tables `bot_`.

## Ce que fait PFlow Bots
- Il relit ces tables à chaque conversation (cache de 4 s). Une modification dans le CRM est donc prise en compte au
  message suivant.
- Il calcule les passages des 14 prochains jours : planning, plus les ajouts, moins les annulations. Un passage du jour
  même compte tant que son créneau n'est pas fini.
- Il donne ces passages à l'IA, qui répond seule. Elle transfère si le lieu n'y est pas, ou si le client veut une
  confirmation précise.
- **Jours fériés** : le CRM n'en connaît pas aujourd'hui. Il faut les saisir comme exceptions « toute la journée »
  (`lieux = '*'`, `annulee = true`).
