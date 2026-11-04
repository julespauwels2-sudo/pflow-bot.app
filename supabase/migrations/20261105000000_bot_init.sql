-- PFlow Bots — étape B : tables propres au bot dans la base du CRM.
-- NON APPLIQUÉE tant que Jules ne l'a pas validée.
--
-- Règles :
-- * uniquement des CRÉATIONS de tables préfixées bot_ ; aucune table, colonne, fonction ou donnée
--   existante du CRM n'est modifiée ;
-- * pas de clé étrangère vers les tables du CRM (une clé étrangère ajouterait des déclencheurs
--   internes sur la table du CRM) : restaurant_id est un simple uuid, vérifié par l'application ;
-- * RLS sur chaque table : seuls les administrateurs du bot (bot_admins) y ont accès ;
-- * les tables bot_reglages et bot_cles existent déjà (module UChat du CRM) : on n'y touche pas.

-- Administrateurs de PFlow Bots (comptes Supabase Auth autorisés).
create table public.bot_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cree_le timestamptz not null default now()
);

-- Modèle maître (trame commune) et son agent IA.
create table public.bot_modeles (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  agent jsonb,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

-- Réglages bot d'un resto du CRM (nom, slug, fuseau, horaires… restent lus dans restaurants).
create table public.bot_clients (
  restaurant_id uuid primary key,
  mode_declenchement text not null default 'mots_cles_uniquement'
    check (mode_declenchement in ('mots_cles_uniquement', 'toujours')),
  modele_id uuid references public.bot_modeles (id) on delete set null,
  lie_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

-- Dossiers de flux (un seul niveau), d'un client ou du modèle maître.
create table public.bot_dossiers (
  id uuid primary key default gen_random_uuid(),
  proprietaire_type text not null check (proprietaire_type in ('client', 'modele')),
  proprietaire_id uuid not null,
  nom text not null,
  ordre integer not null default 0,
  cree_le timestamptz not null default now()
);
create index bot_dossiers_proprietaire on public.bot_dossiers (proprietaire_id);

-- Flux (brouillon et version publiée, au format React Flow).
create table public.bot_flux (
  id uuid primary key default gen_random_uuid(),
  proprietaire_type text not null check (proprietaire_type in ('client', 'modele')),
  proprietaire_id uuid not null,
  dossier_id uuid references public.bot_dossiers (id) on delete set null,
  -- Personnalisation d'un flux du modèle pour un client : id du flux du modèle remplacé.
  remplace_flux_modele_id uuid references public.bot_flux (id) on delete cascade,
  base_version_modele integer,
  nom text not null,
  description text,
  brouillon jsonb not null,
  publie jsonb,
  publie_meta jsonb,
  publie_le timestamptz,
  version integer not null default 0,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index bot_flux_proprietaire on public.bot_flux (proprietaire_id);

-- Partie de la fiche d'infos propre au bot (FAQ, règles spéciales, points de vente…).
-- Horaires, adresse, livraison/retrait, zones et carte sont lus dans le CRM.
create table public.bot_fiches (
  restaurant_id uuid primary key,
  donnees jsonb not null default '{}'::jsonb,
  maj_le timestamptz not null default now()
);

-- Tournées de livraison (mode « sur planning »). Table à part pour que la gérante puisse,
-- plus tard, les modifier depuis son dashboard (droit ajouté à ce moment-là, montré avant).
create table public.bot_tournees (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  date date not null,
  de time,
  a time,
  lieux text not null,
  cree_le timestamptz not null default now()
);
create index bot_tournees_resto_date on public.bot_tournees (restaurant_id, date);

-- Journal des appels IA (tokens et coût par client).
create table public.bot_appels_ia (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  cree_le timestamptz not null default now(),
  source text not null check (source in ('simulateur', 'whatsapp')),
  modele text,
  message text not null,
  decision jsonb,
  usage jsonb,
  cout_usd numeric(12, 8),
  erreur text
);
create index bot_appels_ia_resto_date on public.bot_appels_ia (restaurant_id, cree_le desc);

-- Sécurité : RLS partout, accès réservé aux administrateurs du bot.
alter table public.bot_admins enable row level security;
alter table public.bot_modeles enable row level security;
alter table public.bot_clients enable row level security;
alter table public.bot_dossiers enable row level security;
alter table public.bot_flux enable row level security;
alter table public.bot_fiches enable row level security;
alter table public.bot_tournees enable row level security;
alter table public.bot_appels_ia enable row level security;

-- Chacun voit seulement sa propre ligne (pour savoir s'il est administrateur du bot).
-- Aucun ajout ni retrait depuis l'application : la liste se gère à la main, en SQL.
create policy "bot_admins : sa ligne" on public.bot_admins
  for select to authenticated using (user_id = auth.uid());

create policy "bot_modeles : admins du bot" on public.bot_modeles
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_clients : admins du bot" on public.bot_clients
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_dossiers : admins du bot" on public.bot_dossiers
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_flux : admins du bot" on public.bot_flux
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_fiches : admins du bot" on public.bot_fiches
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_tournees : admins du bot" on public.bot_tournees
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_appels_ia : admins du bot" on public.bot_appels_ia
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));

-- Aucun accès anonyme à ces tables (en plus du RLS).
revoke all on table
  public.bot_admins, public.bot_modeles, public.bot_clients, public.bot_dossiers,
  public.bot_flux, public.bot_fiches, public.bot_tournees, public.bot_appels_ia
from anon;
