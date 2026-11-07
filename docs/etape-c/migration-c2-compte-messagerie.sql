-- PFlow Bots — compte de messagerie d'un canal WhatsApp (7 novembre 2026).
-- PROPOSITION, NON APPLIQUÉE : à déplacer dans supabase/migrations/ après l'accord de Jules.
-- Meta distingue désormais le compte WhatsApp (WABA) et le « compte de messagerie » (Messaging Account,
-- « Paid Message Account ») qui envoie et paie les messages. Le bot l'indique à chaque envoi
-- (messaging_account_id) pour que Meta ne choisisse pas un compte inaccessible au token.
-- Touche uniquement bot_canaux (table du bot) ; aucune table ni donnée du CRM.

-- Partie A : nouvelle colonne (facultative : vide = Meta choisit le compte).
alter table public.bot_canaux add column if not exists messaging_account_id text;

-- Partie B : numéro de test Meta (+1 555 186 2679).
update public.bot_canaux
   set messaging_account_id = '1511896410913657', maj_le = now()
 where plateforme = 'whatsapp' and compte_id = '1482722121584900';
