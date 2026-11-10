-- PFlow Bots : compte examinateur pour l'examen de l'app par Meta.
-- Un examinateur ne voit et ne répond qu'aux conversations du numéro PFlow (démos) dans la boîte de réception
-- (filtrage côté serveur : src/app/api/inbox). Il n'a aucun autre droit dans PFlow Bots (toutes les autres routes
-- exigent bot_admins), et aucun droit dans le CRM (pas dans admins ni acces_restos).
-- Additif : 1 table nouvelle, préfixée bot_. Aucune table existante touchée.
create table if not exists public.bot_examinateurs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  cree_le timestamptz not null default now()
);
alter table public.bot_examinateurs enable row level security;
revoke all on public.bot_examinateurs from anon, authenticated;
grant select on public.bot_examinateurs to authenticated;
drop policy if exists "bot_examinateurs : sa propre ligne" on public.bot_examinateurs;
create policy "bot_examinateurs : sa propre ligne" on public.bot_examinateurs
  for select to authenticated using (user_id = auth.uid());

comment on table public.bot_examinateurs is 'Examinateurs (examen Meta) : boîte de réception limitée au numéro PFlow (démos). Ne jamais y mettre un administrateur.';
