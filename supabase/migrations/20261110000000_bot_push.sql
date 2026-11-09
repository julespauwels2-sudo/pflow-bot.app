-- PFlow Bots : notifications push de la boîte de réception (Web Push, VAPID). NE PAS APPLIQUER sans l'accord de Jules.
-- Tables bot_ uniquement ; aucune table ni donnée du CRM touchée.
-- Sans cette migration : pas d'abonnement enregistré (bouton « Activer les notifications » en erreur), les alertes
-- continuent par WhatsApp et e-mail comme avant.

-- 1. Les abonnements push (un par appareil et par navigateur) des administrateurs du bot.
create table if not exists public.bot_push_abonnements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Adresse du service push (Apple, Google, Mozilla…) : unique par abonnement.
  endpoint text not null unique,
  -- Clés publiques du navigateur (chiffrement du contenu de la notification). Pas des secrets du serveur.
  p256dh text not null,
  auth text not null,
  -- « iPhone (Safari) », pour s'y retrouver sur la page État.
  appareil text,
  cree_le timestamptz not null default now(),
  dernier_envoi_le timestamptz,
  dernier_echec_le timestamptz,
  dernier_echec text
);
create index if not exists bot_push_abonnements_user_idx on public.bot_push_abonnements (user_id);

-- RLS, comme les autres tables bot_ : seul un administrateur du bot voit et gère SES abonnements.
-- Le serveur (clé service_role) envoie les notifications à tous les abonnements.
alter table public.bot_push_abonnements enable row level security;
create policy "bot_push_abonnements : ses abonnements (admins du bot)" on public.bot_push_abonnements
  for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.bot_admins where user_id = auth.uid()));

-- 2. La voie push de chaque alerte (page État), à côté de alerte_voie (WhatsApp / e-mail).
alter table public.bot_transferts
  add column if not exists alerte_push text
    constraint bot_transferts_alerte_push_check check (alerte_push in ('envoyee', 'echec', 'aucun_abonnement', 'non_configure'));

comment on column public.bot_transferts.alerte_push is 'Notification push de l''alerte : envoyee (au moins un appareil), echec, aucun_abonnement ou non_configure (clés VAPID absentes)';
