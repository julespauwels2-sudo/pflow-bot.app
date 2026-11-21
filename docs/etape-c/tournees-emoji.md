# Questions de tournée et emoji d'accueil (21 novembre 2026)

## 1. Questions de tournée (« Vous passez quand à Jarry ? »)

### Ce qui existe pour Cookies An Nou (lecture seule, 21 novembre)
- **Aucun planning de Leslie dans le CRM** : pas de table de tournées côté CRM. Les zones de livraison du CRM
  (`qg_zones_livraison`) ont été vidées pour Cookies.
- **`restaurants`** : livraison oui, retrait non, `sans_creneau`, `creneau_texte` = « Livrée lors du prochain passage
  de Leslie dans votre entreprise (selon son planning) ».
- **Fiche du bot (`bot_fiches.donnees`)** : texte de livraison, FAQ et règles spéciales. Une règle forçait le transfert :
  « Toute question précise sur une date ou un lieu de tournée (« vous passez quand à Jarry ? »…) : utilise
  parler_equipe », avec « Ne jamais citer de zone, de date ni de lieu de tournée ». Le journal des appels à l'IA le
  confirme : le 21 novembre à 20 h 37, « Vous passez quand à Jarry ? » → fonction `parler_equipe`.
- **Tournées datées (`bot_tournees`)** : la table prévue pour ça (fiche du bot → « Tournées datées »), **vide** pour
  Cookies. C'est là que Leslie (ou Jules) doit saisir les passages : date, horaires facultatifs, lieux.

### Ce que fait la PR
- Les tournées à venir étaient déjà données à l'IA (relues à chaque message, cache de 4 s ; les tournées passées
  retirées). La PR ajoute une consigne dans la section « Livraison sur planning » :
  - avec des tournées : l'IA répond elle-même (date, horaire, lieu) ; si le lieu ou la date demandés n'y sont pas,
    elle le dit et propose l'équipe ; elle ne transfère que si le client le veut ou demande une confirmation précise ;
  - sans tournée (mode planning) : n'invente rien, passe la main à l'équipe.
- Mexico et AG Pizza (retrait seulement) : base de connaissances strictement identique (test).
- **La règle de la fiche de Cookies reste à changer** (écriture en base, ci-dessous) : sans ça, elle continue de forcer
  le transfert.

### Écriture proposée sur la fiche de Cookies (NON appliquée, accord de Jules attendu)
Table `bot_fiches` uniquement (préfixe `bot_`), seuls 3 champs du JSON changent, les autres restent intacts.
```sql
update public.bot_fiches f
set donnees = f.donnees
  || jsonb_build_object(
    'zonesLivraison', 'Livraison en entreprise, lors des tournées de Leslie : elle passe dans les entreprises selon son planning (jours et lieux précis). Si votre entreprise n''est pas dans les prochaines tournées, demandez-le ici : l''équipe vous répond.',
    'reglesSpeciales', E'- Livraison uniquement lors des tournées de Leslie dans les entreprises. Pour une date ou un lieu de passage, réponds avec les tournées à venir de la base de connaissances ; n''invente jamais une zone, une date ni un lieu.\n- Si le lieu ou la date demandés ne figurent dans aucune tournée à venir, s''il n''y a aucune tournée, ou si le client veut une confirmation précise (passage dans son entreprise, heure exacte) : utilise parler_equipe.\n- Pas de retrait sur place, sauf dans les 4 points de vente, en quantité limitée.\n- Ne jamais promettre de paiement en ligne : aujourd''hui, le paiement se fait à la livraison.',
    'faq', replace(f.donnees->>'faq',
      'Quand passez-vous dans mon entreprise ? Leslie passe selon son planning : l''équipe vous répond ici avec la date et le lieu.',
      'Quand passez-vous dans mon entreprise ? Leslie passe selon son planning : voir les prochaines tournées. Si votre entreprise n''y est pas, l''équipe vous répond ici avec la date et le lieu.')
  )
where f.restaurant_id = (select id from public.restaurants where nom = 'Cookies An Nou');
```
Effet tant qu'aucune tournée n'est saisie : la question part toujours à l'équipe (rien à citer). Dès qu'une tournée à
venir est saisie dans la fiche, le bot passe « sur planning » tout seul et l'IA répond.

## 2. Emoji d'accueil propre à chaque resto
- Nouveau champ « Emoji d'accueil » dans la fiche d'infos (`emojiAccueil`, 16 caractères au plus), variable
  `{{emoji_accueil}}` ; vide : 🍽️. Ce n'est pas une « info pratique » : en démo, l'Accueil reste l'Accueil.
- Modèle de référence (seed) : `Bienvenue chez {{nom_resto}} {{emoji_accueil}} Une petite faim ?…`.

### En base aujourd'hui (lecture, 21 novembre)
- Accueil du **modèle maître** (`d65d8540…`, v3, publié le 21 à 20 h 41) : « Bienvenue chez {{nom_resto}} . Une
  petite faim ? » (le 🍔 a été retiré, il reste « . »).
- **AG Pizza** a sa propre copie de l'Accueil (`e801f2a3…`, personnalisée le 19) qui garde le 🍔.

### Écritures proposées (NON appliquées, APRÈS fusion et déploiement de la PR)
Avant le déploiement, `{{emoji_accueil}}` serait inconnu de la production : ne rien changer dans les flux avant.

a) Emojis des 3 fiches :
```sql
update public.bot_fiches f set donnees = f.donnees || jsonb_build_object('emojiAccueil', v.emoji)
from (values ('Cookies An Nou', '🍪'), ('Mexico', '🌯'), ('AG Pizza', '🍕')) as v(nom, emoji)
join public.restaurants r on r.nom = v.nom
where f.restaurant_id = r.id;
```
b) Accueil du modèle maître (le plus simple : dans l'éditeur, Modèle maître → Accueil → bulle 1, remplacer « . » par
`{{emoji_accueil}}`, puis Publier). En SQL, équivalent :
```sql
update public.bot_flux
set brouillon = replace(brouillon::text, 'Bienvenue chez {{nom_resto}} . Une', 'Bienvenue chez {{nom_resto}} {{emoji_accueil}} Une')::jsonb,
    publie    = replace(publie::text,    'Bienvenue chez {{nom_resto}} . Une', 'Bienvenue chez {{nom_resto}} {{emoji_accueil}} Une')::jsonb,
    version = version + 1, publie_le = now(), maj_le = now()
where id = 'd65d8540-cc66-4628-a795-18f9ab5c2729';
```
c) Copie d'AG Pizza : même remplacement du 🍔 (ou, au choix de Jules, revenir au modèle maître dans l'éditeur) :
```sql
update public.bot_flux
set brouillon = replace(brouillon::text, 'Bienvenue chez {{nom_resto}} 🍔 Une', 'Bienvenue chez {{nom_resto}} {{emoji_accueil}} Une')::jsonb,
    publie    = replace(publie::text,    'Bienvenue chez {{nom_resto}} 🍔 Une', 'Bienvenue chez {{nom_resto}} {{emoji_accueil}} Une')::jsonb,
    version = version + 1, publie_le = now(), maj_le = now()
where id = 'e801f2a3-b3be-403f-99a7-8889d0e3eb87';
```

## Tests
- `src/ai/__tests__/ai.test.ts` : « Vous passez quand à Jarry ? » avec planning (tournée + consigne de répondre,
  plus de règle qui force le transfert), sans planning (rien d'inventé, transfert), Mexico et AG Pizza identiques.
- `src/data/__tests__/template.test.ts` : la question arrive à l'IA avec la seule tournée à venir et la réponse part
  sans transfert ; accueil des 3 restos (🍪, 🌯, 🍕) et 🍽️ par défaut.
- Captures (simulateur en mode local, aucune écriture en base) : accueil de Cookies, Mexico, AG Pizza et le champ de
  la fiche. Les réponses de l'IA réelle restent à vérifier dans le simulateur de la Preview (« IA réelle »).
