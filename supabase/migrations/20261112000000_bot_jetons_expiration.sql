-- PFlow Bots : échéance des jetons Meta des clients (Embedded Signup, jeton de 60 jours) et suivi du renouvellement.
-- Additif : 4 colonnes nouvelles sur la table bot_jetons_whatsapp (PFlow Bots), aucune autre table touchée.
-- RLS inchangée (activée, aucune règle : serveur seulement).
alter table public.bot_jetons_whatsapp
  add column if not exists expire_le timestamptz,
  add column if not exists n_expire_pas boolean not null default false,
  add column if not exists renouvele_le timestamptz,
  add column if not exists erreur_renouvellement text;

comment on column public.bot_jetons_whatsapp.expire_le is 'Fin de validité du jeton (60 jours) ; renouvelé chaque jour quand il reste moins de 20 jours (/api/cron/jetons)';
comment on column public.bot_jetons_whatsapp.erreur_renouvellement is 'Dernier échec de renouvellement (vide si réussi) : affiché sur la page État avec un lien de reconnexion';
