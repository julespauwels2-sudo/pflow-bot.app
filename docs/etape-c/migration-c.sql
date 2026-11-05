-- PFlow Bots — étape C : WhatsApp et Instagram (comptes, contacts, sessions, messages).
-- Révisée le 5 novembre 2026 (Instagram) : compte_id + plateforme au lieu de phone_number_id,
-- identifiant au lieu de wa_id.
-- Révisée en novembre 2026 (démos sur le numéro PFlow) : bot_canaux.role (+ restaurant_id facultatif
-- pour le numéro PFlow), bot_contacts.demo, nouvelle table bot_demos.
-- PROPOSITION, NON APPLIQUÉE. Rangée dans docs/ (et non dans supabase/migrations/) pour ne jamais être
-- jouée par erreur. Elle y sera déplacée après validation de Jules.
--
-- Mêmes règles que bot_init :
-- * uniquement des tables préfixées bot_ (créations, plus une contrainte élargie sur bot_appels_ia) ;
--   rien n'est modifié dans le CRM ;
-- * pas de clé étrangère vers les tables du CRM (restaurant_id = simple uuid vérifié par l'app) ;
-- * pas de fonction, pas de trigger ; RLS sur chaque table, accès réservé à bot_admins ;
-- * le webhook (serveur) utilise la clé service_role : l'app n'y écrit que dans les tables bot_.
-- Données personnelles (numéros, messages) : accès admin uniquement, purge prévue (plan.md, décision 6).

-- Un compte (numéro WhatsApp ou compte Instagram professionnel) relié à un resto.
create table public.bot_canaux (
  id uuid primary key default gen_random_uuid(),
  -- Vide uniquement pour le numéro PFlow (partagé par toutes les démos).
  restaurant_id uuid,
  -- « resto » : le numéro d'un resto ; « pflow » : le numéro PFlow des démos (aiguillage par mot-clé).
  role text not null default 'resto' check (role in ('resto', 'pflow')),
  plateforme text not null default 'whatsapp' check (plateforme in ('whatsapp', 'instagram')),
  -- Identifiant Meta du compte : WhatsApp = phone_number_id ; Instagram = id du compte professionnel.
  compte_id text not null,
  -- WhatsApp uniquement.
  waba_id text,
  numero_affiche text,
  -- Réglages du canal (remplacent ceux de la fiche client, provisoires depuis A3).
  mode_declenchement text not null default 'mots_cles_uniquement'
    check (mode_declenchement in ('mots_cles_uniquement', 'toujours')),
  coexistence boolean not null default false,
  pause_echo_heures integer not null default 12 check (pause_echo_heures between 1 and 168),
  pause_transfert_heures integer not null default 24 check (pause_transfert_heures between 1 and 168),
  session_minutes integer not null default 30 check (session_minutes between 5 and 1440),
  -- Numéro du gérant prévenu lors d'un transfert (format international, chiffres).
  tel_alerte text,
  -- Le bot répond seulement si actif ; « test » : seulement aux numéros de test_numeros.
  etat text not null default 'test' check (etat in ('test', 'actif', 'coupe')),
  test_numeros text[] not null default '{}',
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (plateforme, compte_id),
  check ((role = 'resto' and restaurant_id is not null) or (role = 'pflow' and restaurant_id is null))
);
create index bot_canaux_resto on public.bot_canaux (restaurant_id);

-- Un contact d'un canal (client du resto).
create table public.bot_contacts (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.bot_canaux (id) on delete cascade,
  -- WhatsApp : numéro (wa_id) ; Instagram : identifiant du client (IGSID).
  identifiant text not null,
  profil_nom text,
  -- Pause du bot pour ce contact (transfert, gérant qui a répondu, manuelle). jusqu_a null = sans fin.
  pause_raison text check (pause_raison in ('transfert_humain', 'echo_gerant', 'manuel')),
  pause_jusqu_a timestamptz,
  -- Fenêtre de 24 h : date du dernier message du contact.
  dernier_entrant_le timestamptz,
  -- Compteur d'appels IA (jour du fuseau du resto).
  ia_jour date,
  ia_appels integer not null default 0,
  -- Le contact ne veut plus de messages d'options (relance, avis). Le service reste possible s'il écrit.
  stop_options boolean not null default false,
  -- Numéro PFlow : démo en cours ({ clientId, lastAt, visited[] }), null ailleurs.
  demo jsonb,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (canal_id, identifiant)
);

-- La conversation en cours (une par contact au plus).
create table public.bot_sessions (
  contact_id uuid primary key references public.bot_contacts (id) on delete cascade,
  flux_id text not null,
  bloc_id text not null,
  variables jsonb not null default '{}'::jsonb,
  essais integer not null default 0,
  ia_historique jsonb,
  debut_le timestamptz not null,
  expire_le timestamptz not null,
  -- Verrou optimiste : deux messages simultanés ne s'écrasent pas.
  version integer not null default 0
);

-- Les messages (entrants, sortants, échos du gérant), pour la boîte de réception et le journal.
create table public.bot_messages (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.bot_canaux (id) on delete cascade,
  contact_id uuid not null references public.bot_contacts (id) on delete cascade,
  sens text not null check (sens in ('entrant', 'sortant', 'echo')),
  -- Auteur d'un message sortant : le bot, ou une personne depuis la boîte de réception.
  auteur text check (auteur in ('bot', 'humain')),
  wamid text unique,
  type text not null,
  contenu jsonb not null,
  statut text check (statut in ('recu', 'envoye', 'delivre', 'lu', 'echec')),
  erreur text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index bot_messages_contact_date on public.bot_messages (contact_id, cree_le desc);
create index bot_messages_canal_date on public.bot_messages (canal_id, cree_le desc);

-- Les transferts humains à traiter (alertes de la boîte de réception).
create table public.bot_transferts (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.bot_canaux (id) on delete cascade,
  contact_id uuid not null references public.bot_contacts (id) on delete cascade,
  source text not null check (source in ('bloc', 'ia', 'limite_ia', 'erreur_ia')),
  dernier_message text,
  gerant_prevenu boolean not null default false,
  cree_le timestamptz not null default now(),
  vu_le timestamptz,
  resolu_le timestamptz
);
create index bot_transferts_ouverts on public.bot_transferts (canal_id, cree_le desc) where resolu_le is null;

-- Événements reçus (Meta, PFlow Order) : traités une seule fois, gardés 30 jours pour le diagnostic.
create table public.bot_webhook_evenements (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('whatsapp', 'instagram', 'pflow_order')),
  -- wamid du message, id du statut, ou « commande:<id>:<événement> » : un renvoi n'est jamais retraité.
  cle_unique text not null unique,
  charge jsonb not null,
  recu_le timestamptz not null default now(),
  traite_le timestamptz,
  erreur text
);
create index bot_webhook_evenements_date on public.bot_webhook_evenements (recu_le);

-- bot_appels_ia (créée par bot_init, table du bot) : accepter la source « instagram ». En attendant, les
-- appels IA venus d'Instagram sont notés « whatsapp » (= canal réel), voir src/channels/core/runtime.ts.
alter table public.bot_appels_ia drop constraint bot_appels_ia_source_check;
alter table public.bot_appels_ia add constraint bot_appels_ia_source_check check (source in ('simulateur', 'whatsapp', 'instagram'));

-- Démos sur le numéro PFlow : mot-clé, durée, expiration. À l'expiration, l'app supprime les données
-- bot_ du resto (jamais le CRM) et garde cette ligne (supprime_le) pour ne pas recréer le bot.
create table public.bot_demos (
  restaurant_id uuid primary key,
  mot_cle text not null,
  -- Mot-clé sans casse, accents ni ponctuation : unique parmi les démos en cours.
  mot_cle_normalise text not null,
  duree_jours integer not null default 5 check (duree_jours between 1 and 60),
  debut_le timestamptz not null default now(),
  expire_le timestamptz not null,
  supprime_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create unique index bot_demos_mot_cle_en_cours on public.bot_demos (mot_cle_normalise) where supprime_le is null;

-- Sécurité : RLS partout, accès réservé aux administrateurs du bot.
alter table public.bot_canaux enable row level security;
alter table public.bot_contacts enable row level security;
alter table public.bot_sessions enable row level security;
alter table public.bot_messages enable row level security;
alter table public.bot_transferts enable row level security;
alter table public.bot_webhook_evenements enable row level security;
alter table public.bot_demos enable row level security;

create policy "bot_canaux : admins du bot" on public.bot_canaux
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_contacts : admins du bot" on public.bot_contacts
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_sessions : admins du bot" on public.bot_sessions
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_messages : admins du bot" on public.bot_messages
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_transferts : admins du bot" on public.bot_transferts
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_demos : admins du bot" on public.bot_demos
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
-- Les événements bruts : lecture seule pour les admins (diagnostic), écriture par le serveur uniquement.
create policy "bot_webhook_evenements : lecture admins" on public.bot_webhook_evenements
  for select to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()));

revoke all on table
  public.bot_canaux, public.bot_contacts, public.bot_sessions, public.bot_messages,
  public.bot_transferts, public.bot_webhook_evenements, public.bot_demos
from anon;
