-- PFlow Bots : « Connecter votre WhatsApp » (Embedded Signup v4 avec coexistence). NE PAS APPLIQUER sans l'accord de Jules.
-- Tables bot_ uniquement ; aucune table ni donnée du CRM touchée ; pas de clé étrangère vers le CRM
-- (restaurant_id = simple uuid vérifié par l'app). RLS sur chaque table.
-- Sans cette migration : la page de connexion répond « pas encore disponible », rien d'autre ne change.

-- 1. Une demande de connexion : le lien unique envoyé au gérant, puis le déroulé (étapes, erreurs).
create table if not exists public.bot_connexions_whatsapp (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  -- Empreinte SHA-256 du jeton du lien : le jeton lui-même n'est jamais gardé (le lien ne se retrouve pas en base).
  jeton_hash text not null unique,
  expire_le timestamptz not null,
  etat text not null default 'lien_envoye'
    check (etat in ('lien_envoye', 'en_cours', 'terminee', 'erreur', 'annulee', 'expiree')),
  -- Ce que Meta renvoie à la fin du parcours (identifiants, pas des secrets).
  business_id text,
  waba_id text,
  phone_number_id text,
  numero_affiche text,
  canal_id uuid references public.bot_canaux (id) on delete set null,
  -- Le déroulé : [{ etape, ok, detail, le }] (code échangé, app abonnée, synchronisation, canal créé, modèles…).
  etapes jsonb not null default '[]'::jsonb,
  erreur text,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  termine_le timestamptz
);
create index if not exists bot_connexions_whatsapp_resto on public.bot_connexions_whatsapp (restaurant_id);

alter table public.bot_connexions_whatsapp enable row level security;
create policy "bot_connexions_whatsapp : admins du bot" on public.bot_connexions_whatsapp
  for all to authenticated
  using (exists (select 1 from public.bot_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.bot_admins where user_id = auth.uid()));

-- 2. Le jeton d'accès Meta de chaque client (un par compte WhatsApp Business), CHIFFRÉ.
--    Chiffrement AES-256-GCM côté serveur avec la clé BOT_JETONS_CLE (variable Vercel, jamais en base ni dans Git) :
--    la base ne contient que du chiffré. Aucune règle RLS : seul le serveur (clé service_role) y accède,
--    ni l'app, ni un administrateur connecté ne peuvent le lire.
create table if not exists public.bot_jetons_whatsapp (
  waba_id text primary key,
  restaurant_id uuid not null,
  -- « v1:<iv base64>:<tag base64>:<chiffré base64> »
  jeton_chiffre text not null,
  -- Type renvoyé par Meta (jeton d'utilisateur système d'intégration métier), pour le suivi.
  type_jeton text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
alter table public.bot_jetons_whatsapp enable row level security;
revoke all on public.bot_jetons_whatsapp from anon, authenticated;

comment on table public.bot_jetons_whatsapp is 'Jetons Meta des clients (Embedded Signup), chiffrés AES-256-GCM avec BOT_JETONS_CLE ; serveur seulement';
