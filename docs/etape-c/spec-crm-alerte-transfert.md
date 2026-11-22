# Spécification pour le CRM : notification « transfert » avec son propre son (22 novembre 2026)

## Ce que PFlow Bots envoie
Toujours la même fonction, `public.app_alerte_bot`, avec un **paramètre en plus** :

| paramètre | valeur |
|---|---|
| `p_type` | `'transfert'` : un client attend l'équipe (transfert depuis un resto ou depuis la démo, « Parler à Jules »). Absent (ou `'prospect'`) : « Je veux le mien », questions de la démo, alertes techniques, comme aujourd'hui. |

PFlow Bots n'envoie `p_type` que pour les transferts. Si la fonction ne connaît pas encore ce paramètre (erreur 404 ou
400), il renvoie l'alerte sans lui, en « prospect », comme aujourd'hui : rien ne se perd.

## Ce que le CRM doit faire (PR du CRM)
1. **Nouvelle version de la fonction**, compatible avec l'ancienne :
   ```sql
   create or replace function public.app_alerte_bot(p_cle text, p_titre text, p_corps text default null, p_url text default null, p_type text default 'prospect')
   ```
   - type posé = `case when p_type = 'transfert' then 'transfert' else 'prospect' end` (toute autre valeur donne
     « prospect ») ;
   - le reste ne change pas : même clé `bot:…`, mêmes longueurs, même URL par défaut.
   - **Attention** : l'ancienne fonction à 4 paramètres doit être **remplacée** (supprimée puis recréée dans la même
     transaction). Sinon les deux versions coexistent et l'appel sans `p_type` devient ambigu.
2. **Type de notification `transfert`** dans `qg_notif_poser`, `qg-notifier` et l'appli :
   - son dédié (différent de « prospect ») ;
   - réglable dans Plus → Notifications ;
   - soumis aux mêmes heures de silence.
3. **Ordre de mise en production** : la PR du CRM d'abord (fonction et type), puis la PR PFlow Bots.
