-- PFlow Bots : par où est partie l'alerte d'un transfert (page État). APPLIQUÉE le 9 novembre 2026, avec l'accord de Jules.
-- Table bot_ uniquement ; aucune table ni donnée du CRM touchée. RLS : inchangée (déjà active sur bot_transferts).
-- (Le code reste compatible avec une base sans ces colonnes : repli automatique.)
alter table public.bot_transferts
  add column if not exists alerte_voie text
    constraint bot_transferts_alerte_voie_check check (alerte_voie in ('texte', 'modele', 'email', 'aucune')),
  add column if not exists alerte_erreur text;

comment on column public.bot_transferts.alerte_voie is 'Alerte au gérant : texte (fenêtre 24 h ouverte), modele (modèle approuvé), email (secours) ou aucune';
comment on column public.bot_transferts.alerte_erreur is 'Erreurs des tentatives d''alerte (message libre, modèle, e-mail)';
