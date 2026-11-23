-- Tournées récurrentes (22 novembre 2026) : planning hebdomadaire des tournées, lu et écrit par PFlow Bots ET par le
-- CRM (la gérante, depuis son dashboard). Additive : une table nouvelle (préfixe bot_), une colonne ajoutée à une table
-- bot_, une règle d'accès ajoutée. Aucune table ni donnée du CRM modifiée ; a_acces() du CRM est seulement appelée.

-- 1. Planning de chaque semaine : un ou plusieurs lieux par jour, avec un créneau facultatif.
create table public.bot_tournees_hebdo (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  jour smallint not null check (jour between 1 and 7),          -- ISO : 1 = lundi … 7 = dimanche
  lieux text not null check (length(btrim(lieux)) between 1 and 300),
  de time,
  a time,
  ordre smallint not null default 0,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  check (de is null or a is null or a > de)
);
create index bot_tournees_hebdo_resto on public.bot_tournees_hebdo (restaurant_id, jour, ordre);

alter table public.bot_tournees_hebdo enable row level security;
create policy "bot_tournees_hebdo : admins du bot" on public.bot_tournees_hebdo
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));
create policy "bot_tournees_hebdo : son resto" on public.bot_tournees_hebdo
  for all to authenticated
  using (public.a_acces(restaurant_id))
  with check (public.a_acces(restaurant_id));
revoke all on table public.bot_tournees_hebdo from anon;

-- 2. Exceptions datées (table existante bot_tournees) : un passage du planning ANNULÉ un jour précis (lieux « * » :
--    toute la journée). Une ligne sans ce drapeau reste un passage ajouté, comme aujourd'hui.
alter table public.bot_tournees add column annulee boolean not null default false;

-- 3. La gérante modifie aussi les exceptions de SON resto depuis le CRM (prévu dès la création de la table).
create policy "bot_tournees : son resto" on public.bot_tournees
  for all to authenticated
  using (public.a_acces(restaurant_id))
  with check (public.a_acces(restaurant_id));
