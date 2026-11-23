-- Boîte de réception (22 novembre 2026) : non-lus synchronisés entre appareils, et mise à jour en temps réel.
-- Additive : une table nouvelle (préfixe bot_) et deux tables bot_ ajoutées à la publication Realtime. Aucune table ni
-- donnée du CRM modifiée (les 2 tables du CRM déjà dans la publication y restent).

-- 1. Dernière lecture de chaque conversation par utilisateur (ordinateur et iPhone synchronisés).
create table public.bot_lectures (
  user_id uuid not null,
  contact_id uuid not null references public.bot_contacts (id) on delete cascade,
  lu_jusqua timestamptz not null,
  maj_le timestamptz not null default now(),
  primary key (user_id, contact_id)
);
alter table public.bot_lectures enable row level security;
-- Écrite par le serveur (clé de service) ; un administrateur connecté ne voit que ses propres lectures.
create policy "bot_lectures : les siennes" on public.bot_lectures
  for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.bot_admins where user_id = auth.uid()));
revoke all on table public.bot_lectures from anon;

-- 2. Temps réel : nouveaux messages et changements de pause poussés à l'écran. Les règles d'accès (RLS) s'appliquent :
--    seuls les administrateurs du bot reçoivent ces changements.
alter publication supabase_realtime add table public.bot_messages, public.bot_contacts;
