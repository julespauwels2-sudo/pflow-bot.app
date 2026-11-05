# Sécurité du CRM (PFlow Order) — analyse et corrections proposées

**Fait le 5 novembre 2026, en lecture seule.** Rien n'a été modifié : ni la base, ni le dépôt
`Pflow-Crm`. Sources : le conseiller de sécurité de Supabase, la lecture du code des fonctions et des
règles dans la base (catalogue), et la copie locale de `Pflow-Crm` (commit `5ac768c`) pour voir qui
appelle quoi. **Tout le SQL ci-dessous est une proposition à relire. Ne rien lancer sans l'avoir testé
sur une branche Supabase ou à un moment calme.**

## Rappel : qui est « anon », qui est « authenticated » ?

- **anon** = n'importe qui sur Internet. La clé « anon » de Supabase est publique (elle est dans le
  mini-site), donc toute fonction ou table ouverte à `anon` est appelable par le monde entier.
- **authenticated** = n'importe quel compte connecté : toi, l'autre admin, **et les 4 comptes de
  restaurateurs** (8 comptes en tout, 2 admins).
- Une fonction **security definer** s'exécute avec les droits de son propriétaire (tous les droits) :
  elle doit donc vérifier elle-même qui l'appelle.

## Ce qui va bien (vérifié)

- **Aucune table lisible sans règle** : le RLS est actif partout. Les commandes ne sont lisibles que par
  les admins et le resto concerné ; la règle « sans les tests » ouverte à `anon` est *restrictive* (elle
  ne donne aucun accès, elle en retire). Les visiteurs ne voient que la carte des restos actifs.
- **Fonctions d'admin** (`lier_acces`, `retirer_acces`, `acces_du_resto`, facturation `fa_*`…) :
  toutes vérifient `est_admin()` ou `fa_admin()` en première ligne.
- **72 fonctions du « pont »** vérifient la clé `PONT_CLE` (empreinte SHA-256 stockée, 16 caractères
  minimum). La clé n'est utilisée que côté serveur (fonctions Vercel `api/*.js`), jamais dans le
  navigateur.
- **Liens publics** (contrat, facture, désinscription, reprise de panier, paiement sur place) : jetons
  aléatoires (UUID ou 64 caractères hexadécimaux), durées de validité, textes bornés. Bon travail.
- **Personne ne peut créer d'objet** dans le schéma `public` (anon et authenticated n'en ont pas le
  droit) : les fonctions sans `search_path` fixé ne sont donc pas exploitables aujourd'hui.

## Les points, du plus grave au moins grave

| # | Gravité | Point | En une phrase |
|---|---|---|---|
| 1 | 🟠 Moyenne | Buckets publics listables (`menus`, `contenu-video`, `cartes`) | N'importe qui peut lister les fichiers, et les noms de dossiers sont des jetons |
| 2 | 🟠 Moyenne | Une seule clé (`PONT_CLE`) ouvre 72 fonctions sensibles | Si elle fuit, paiements, commandes et clés UChat sont exposés |
| 3 | 🟠 Moyenne | Comptes admins sans double authentification ni contrôle des mots de passe divulgués | Un mot de passe volé = tout le CRM |
| 4 | 🟡 Faible | `qg_onboarding_lancer` appelable par n'importe qui | Oubli : fonction interne laissée publique |
| 5 | 🟡 Faible | `pg_net` (requêtes web depuis la base) autorisé à anon | Pas appelable par l'API aujourd'hui, mais droit inutile |
| 6 | 🟡 Faible | Vue `vitrine` (signalée « erreur » par Supabase) | Liste publique des restos actifs avec téléphones : voulu, mais listable |
| 7 | 🟡 Faible | Commandes publiques : fausses commandes possibles | Nuisance, un garde-fou anti-abus existe |
| 8 | ⚪ Très faible | Quelques fonctions d'info lisibles par tout compte connecté | Un restaurateur peut savoir si un autre resto est en démo / abonné |
| 9 | ⚪ Très faible | 24 fonctions de déclencheurs « exécutables » par anon | Postgres refuse de les appeler hors déclencheur |
| 10 | ⚪ Très faible | 117 fonctions sans `search_path` fixé | Pas exploitable aujourd'hui (voir plus haut) ; hygiène |
| 11 | ⚪ Info | 6 tables avec RLS mais sans règle (`bot_cles`, `pont_config`…) | Fermées à tous : c'est le comportement voulu |
| 12 | ⚪ Info | `ig_fichier_lire` publique | Voulu (Instagram télécharge les visuels) ; identifiant aléatoire, effacés après 7 jours |

---

### 1. 🟠 Buckets publics listables

**Ce qui se passe.** Les buckets `menus`, `cartes` et `contenu-video` sont publics (normal : les
images s'affichent par leur adresse publique). Mais ils ont *en plus* une règle « lecture » ouverte à
tout le monde, qui permet de **lister** leur contenu par l'API. Or les noms de dossiers sont des jetons :

- `menus/<id de fiche>/…` : l'identifiant de la **fiche d'onboarding** est aussi le jeton qui permet de
  la remplir (`deposer_fiche`). Aujourd'hui : 8 fichiers, **3 fiches encore ouvertes**.
- `contenu-video/<jeton de rendu>/…` : jeton de dépôt des vidéos Instagram (valable 2 heures).
- `cartes/<id du resto>/…` : révèle les identifiants des restos (peu grave).

**Risque concret.** Quelqu'un qui connaît l'adresse Supabase (publique) liste `menus`, récupère les
3 jetons, et **réécrit le questionnaire de démarrage** d'un nouveau client (carte, horaires, zones)
tant que la fiche est « en attente » ou « reçue ». Tu mettrais en place un bot avec de fausses infos.
Même chose, en plus étroit, pour déposer ou effacer une vidéo pendant un rendu.

**Ce que le CRM utilise.** Lecture par adresse publique (`getPublicUrl`) et dépôts : **aucun listing**
dans le code. Attention : supprimer un fichier par l'API demande aussi le droit de lecture, d'où les
règles de remplacement ci-dessous (réservées aux admins / au resto).

```sql
-- 1a. menus : plus de listing public ; les admins gardent lecture (nécessaire pour supprimer).
drop policy "menus lecture" on storage.objects;
create policy "menus lecture admins" on storage.objects for select to authenticated
  using (bucket_id = 'menus' and public.est_admin());

-- 1b. cartes : lecture réservée au resto concerné (et aux admins via a_acces).
drop policy "cartes lecture" on storage.objects;
create policy "cartes lecture du resto" on storage.objects for select to authenticated
  using (bucket_id = 'cartes' and public.a_acces(((storage.foldername(name))[1])::uuid));

-- 1c. contenu-video : le script de rendu supprime avec la clé anon (rendu-reels/rendre.js, purger) :
-- il a besoin de la lecture. On la limite aux dossiers dont le jeton est encore valide pour la purge.
drop policy "contenu-video lecture" on storage.objects;
create policy "contenu-video lecture purge" on storage.objects for select to anon, authenticated
  using (bucket_id = 'contenu-video' and public.ig_rendu_jeton_purge((storage.foldername(name))[1]));
```

**À tester après** : affichage des menus et cartes sur le mini-site et dans le CRM (adresses publiques,
ne doivent pas changer), dépôt d'un menu depuis le questionnaire, suppression d'une image par un admin,
un rendu vidéo complet puis sa purge. Pour 1c : `ig_rendu_jeton_purge` n'accepte que les rendus dont la
purge est demandée (`purge_demandee`), donc la purge continue de marcher et le listing ne montre plus
que des dossiers en cours d'effacement. Le dépôt des vidéos (`x-upsert: false`) n'a besoin que du
droit d'insertion.

---

### 2. 🟠 Une seule clé pour 72 fonctions sensibles

**Ce qui se passe.** Les fonctions du pont (bot UChat, paiements Stripe et SumUp, factures,
abonnements, agent Instagram, supervision…) sont ouvertes à `anon` et protégées **uniquement** par
`PONT_CLE`. La vérification est correcte (empreinte, 16 caractères minimum) et la clé reste sur Vercel.

**Risque concret si la clé fuit** (capture d'écran, copie dans un message, ancien fichier `.env`,
prestataire) : n'importe qui peut, depuis chez lui, avec la clé anon publique :
- **marquer une commande comme payée** sans payer (`paiement_confirmer`, `paiement_confirmer_sumup`) ;
- lire les commandes et coordonnées des clients d'un resto (`bot_commandes_client`, `pont_suivi`) ;
- **lire les clés API UChat** des restos (`bot_reglages_serveur` renvoie `cle_bot`) ;
- lire / écrire dans les tables de l'agent Instagram (`ig_depot`, limité à une liste de tables) ;
- noter des remboursements, des abonnements, des factures payées.

**Corrections proposées** (de la plus simple à la plus solide) :
1. **Vérifier la longueur de la clé actuelle** : la base accepte 16 caractères ; viser **40+ caractères
   aléatoires**. Si elle a déjà été copiée ailleurs que dans Vercel, **la changer** (bouton « Tester le
   bot » du CRM, qui appelle `pont_relier`, puis mettre la nouvelle valeur dans Vercel).
2. Relever le minimum dans `pont_relier` et `pont_cle_valide` à 32 caractères (dans `pont_relier`, remplacer `< 16` par `< 32`) :

```sql
-- Après avoir posé une clé de 32+ caractères. Même corps qu'aujourd'hui, seul le minimum change.
-- (mêmes attributs qu'aujourd'hui : sql, stable, security definer, search_path=public)
create or replace function public.pont_cle_valide(p_cle text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(length(p_cle) >= 32, false) and exists (
    select 1 from public.pont_config
    where id = 1 and cle_hash = encode(sha256(convert_to(p_cle, 'UTF8')), 'hex'));
$$;
```

3. **Plus solide, plus tard** : que les fonctions Vercel du CRM appellent ces fonctions avec la clé
   **service_role** (déjà secrète, jamais dans le navigateur) au lieu de la clé anon, puis retirer le
   droit à `anon`. Il faut alors **deux** secrets pour attaquer. Demande une modification de
   `api/*.js` et `rendu-reels/rendre.js` : à faire avec moi, fonction par fonction.

```sql
-- Seulement APRÈS le passage des appels serveur en service_role (sinon tout le pont s'arrête).
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.prosrc ~ 'pont_cle_valide\(p_cle\)'
  loop execute format('revoke execute on function %s from anon, public', f.sig); end loop;
end $$;
```

---

### 3. 🟠 Comptes admins

**Ce qui se passe.** 2 comptes admins ouvrent tout le CRM (clients, commandes, factures, contrats,
clés). Supabase signale que la **protection contre les mots de passe divulgués** est désactivée, et
aucun admin n'a de **double authentification**.

**Risque concret.** Un mot de passe réutilisé sur un site piraté suffit à prendre le contrôle du CRM.

**Corrections** (réglages, pas de SQL) :
- Mot de passe long et **unique** pour les 2 admins (gestionnaire de mots de passe).
- **Double authentification (TOTP)** pour les admins : Supabase la propose gratuitement, mais l'écran
  de connexion du CRM doit la gérer (petit développement à prévoir) ; on peut ensuite l'exiger dans
  `est_admin()` (`auth.jwt()->>'aal' = 'aal2'`).
- Protection des mots de passe divulgués : réglage Auth de Supabase (⚠️ offre payante d'après leur
  documentation, à vérifier).

---

### 4. 🟡 `qg_onboarding_lancer` appelable par n'importe qui

**Ce qui se passe.** Cette fonction prépare l'onboarding après la signature d'un contrat (lien
d'abonnement, propositions à l'atelier, fiche de démarrage). Elle est appelée par le déclencheur de
signature, pas par le navigateur, mais elle est restée ouverte à `anon`, **sans vérification**.

**Risque concret.** Faible : il faut connaître l'identifiant interne d'un contrat signé (UUID, jamais
publié : le lien public du contrat utilise un autre jeton). Avec lui, quelqu'un obtiendrait le **jeton
du lien d'abonnement** et pourrait relancer la création de propositions.

```sql
revoke execute on function public.qg_onboarding_lancer(uuid) from public, anon, authenticated;
```

Sans effet sur le fonctionnement : le déclencheur `qg_onboarding_apres_signature` s'exécute avec les
droits du propriétaire. Aucun appel depuis le code du CRM (vérifié).

---

### 5. 🟡 `pg_net` autorisé à anon et authenticated

**Ce qui se passe.** `net.http_post`, `net.http_get`, `net.http_delete` (envoyer des requêtes web
depuis la base) sont exécutables par `anon` et `authenticated`. L'API de Supabase n'expose pas le
schéma `net` par défaut, donc ce n'est **pas appelable de l'extérieur aujourd'hui** ; mais si un jour
`net` était exposé ou si une fonction mal écrite le permettait, la base pourrait servir à envoyer des
requêtes vers n'importe où.

Les 12 fonctions du CRM qui l'utilisent (`ag_tic`, `sup_tic`, `qg_contrat_apres_signature`…) sont
toutes *security definer* : elles gardent le droit après la correction.

```sql
revoke execute on all functions in schema net from anon, authenticated;
```

(L'extension installée dans `public` — autre avertissement de Supabase — ne se déplace pas sans la
réinstaller : à laisser.)

---

### 6. 🟡 Vue `vitrine` (« erreur » pour Supabase)

**Ce qui se passe.** La vue s'exécute avec les droits de son créateur (elle contourne le RLS de
`restaurants`) et elle est lisible par tous. Elle montre, pour les **3 restos actifs** : nom, slug,
téléphone, numéro WhatsApp, couleur, logo, horaires, frais de livraison, mode de paiement.

**Risque concret.** Ces informations sont publiques sur chaque mini-site, mais la vue permet d'obtenir
**la liste complète de tes clients d'un coup** (le pont l'interroge avec `select=*&limit=500`). Un
concurrent pourrait récupérer ta liste de clients et leurs numéros. Aucune donnée des clients finaux.

**Proposition.** La rendre « security invoker » casserait le mini-site (il faudrait ouvrir la table
`restaurants` entière à `anon`, ce qui serait pire). Options :
- **accepter** et documenter (recommandé à court terme) :

```sql
comment on view public.vitrine is
  'Publique volontairement (mini-site, pont). Contourne le RLS de restaurants : n''y ajouter AUCUNE colonne privée.';
```

- plus tard : faire lire la vue par le pont avec la clé service_role, et ne laisser à `anon` qu'une
  fonction « un resto par slug » (pas de liste). Demande une modification de `api/pont.js` et
  `confidentialite.html`.

---

### 7. 🟡 Fausses commandes

`passer_commande`, `commander_en_ligne`, `panier_noter` sont publiques par nature (le mini-site).
Les prix sont recalculés par la base, les textes bornés, les doublons évités, et un déclencheur
`commande_anti_abus` existe (non audité en détail ici). **Risque** : quelqu'un envoie des dizaines de
fausses commandes à un resto (nuisance, pas de vol de données). **Proposition** : relire
`commande_anti_abus` (limite par téléphone / adresse IP / minute) ; règle de limitation du pare-feu
Vercel devant le mini-site. Pas de SQL proposé sans avoir relu le déclencheur.

---

### 8. ⚪ Fonctions d'information lisibles par tout compte connecté

`qg_est_demo`, `qg_abo_stripe`, `pf_module_ok`, `ag_ids_a_rediger`, `qg_sport_prochaine`,
`qg_sport_demarrer` : aucune vérification, ouvertes à tout compte connecté. **Risque** : un
restaurateur connecté pourrait savoir si un autre resto (dont il connaît l'identifiant) est en démo ou
abonné, ou voir ton programme de sport 🙂. Rien de modifiable.

**Attention, ne pas retirer le droit à `authenticated`** : `qg_sport_*` est appelée par ta page Sport
(`js/qg-sport.js`, connectée en admin), et `qg_est_demo`, `qg_abo_stripe`, `pf_module_ok` sont
utilisées par d'autres fonctions SQL. La bonne correction est d'**ajouter une vérification au début**
de chaque fonction, sans changer le reste :

```sql
-- Modèle à appliquer dans le corps (plpgsql) de qg_sport_prochaine, qg_sport_demarrer,
-- ag_ids_a_rediger, en recopiant leur corps actuel (pg_get_functiondef) :
--   if not public.est_admin() then raise exception 'reserve aux admins'; end if;
-- Pour une fonction en langage sql (pas de « if »), ajouter à la requête :  ... and public.est_admin()
```

---

### 9. ⚪ Fonctions de déclencheurs

24 fonctions qui renvoient `trigger` sont « exécutables » par anon. Postgres refuse de les appeler
autrement que par un déclencheur : **aucun risque**. Nettoyage possible (sans effet sur leur
fonctionnement) :

```sql
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and pg_get_function_result(p.oid) = 'trigger'
  loop execute format('revoke execute on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
```

---

### 10. ⚪ 117 fonctions sans `search_path` fixé

Exploitable seulement par quelqu'un qui peut créer des objets dans un schéma : ni anon ni authenticated
ne le peuvent (vérifié). Hygiène recommandée par Supabase. **Ne pas lancer en bloc** : générer la
liste, la relire, puis l'appliquer par petits groupes.

```sql
-- Génère les commandes (n'applique rien) :
select format('alter function %s set search_path = public, pg_temp;', p.oid::regprocedure)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
 order by 1;
```

---

## Ordre conseillé

1. **Point 3** (mots de passe des admins) et **point 2.1** (longueur / rotation de `PONT_CLE`) :
   aucun risque de casse, 15 minutes.
2. **Point 4** puis **point 5** : une ligne chacun, aucun effet attendu.
3. **Point 1** : la vraie correction utile, à tester (mini-site, questionnaire, rendu vidéo).
4. Points 9 et 10 : nettoyage, quand tu as du temps.
5. Points 2.3 et 6 (service_role pour le pont) : chantier à faire ensemble, avec les modifications de
   `Pflow-Crm`.
