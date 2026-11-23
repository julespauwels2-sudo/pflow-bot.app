# Boîte de réception : recherche, temps réel, non-lus synchronisés (22 novembre 2026)

## Recherche
- **Où** : un champ au-dessus de la liste, sur ordinateur et sur iPhone.
- **Quoi** : par nom, par numéro (3 chiffres ou plus) ou par contenu d'un message : texte du client, du bot, de l'équipe
  et transcription des vocaux.
- **Comment** : sans tenir compte des majuscules ni des accents. La recherche part 300 ms après la dernière frappe. La
  ligne montre l'extrait trouvé (🔎 « … »).
- **Côté serveur** : une requête sur `bot_messages` (200 résultats au plus, les plus récents), en plus des noms et
  numéros.

## Temps réel
- **Avec Supabase Realtime** : un message reçu ou envoyé (`bot_messages`) ou un changement de pause (`bot_contacts`)
  recharge la liste et la conversation ouverte en ~0,3 s. Un rafraîchissement toutes les 60 s reste en filet de
  sécurité.
- **Repli** : si le temps réel n'est pas branché (migration pas appliquée, connexion coupée, mode local), l'écran se
  rafraîchit toutes les 5 s comme avant.
- **Indicateur sous la recherche** : « ● Mise à jour en temps réel » ou « ○ Mise à jour toutes les 5 s ».
- **Accès** : les règles déjà en place s'appliquent. Seuls les administrateurs du bot reçoivent ces changements. Un
  examinateur Meta reste sur le rafraîchissement.

## Non-lus synchronisés
- **Ce qui est enregistré** : quand une conversation est ouverte, sa dernière lecture est enregistrée pour l'utilisateur
  (table `bot_lectures`).
- **Calcul** : la lecture la plus récente gagne, celle de l'appareil ou celle du serveur. Lu sur l'iPhone = lu sur
  l'ordinateur.
- **Tant que la table n'existe pas** : chaque appareil garde sa mémoire locale, comme avant.

## Migration (NON appliquée, à valider)
`supabase/migrations/20261122010000_bot_inbox_lectures_realtime.sql` :
- table `bot_lectures`, avec une règle d'accès « les siennes » ;
- `bot_messages` et `bot_contacts` ajoutées à la publication `supabase_realtime`. Les 2 tables du CRM qui y sont déjà
  n'ont pas changé.

## Ce qui reste
- La recherche porte sur les 200 messages les plus récents qui correspondent.
- Pas de surlignage du mot dans la conversation ouverte.
