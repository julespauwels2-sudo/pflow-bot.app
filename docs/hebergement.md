# Hébergement : Vercel Pro ou Edge Functions Supabase ? (7 novembre 2026)

## Le constat

- **Usage commercial** : l'offre gratuite de Vercel (Hobby) est réservée à un usage personnel et non
  commercial. Or **order.pflow.fr** (le CRM et les pages de commande, payés par les restos), le site
  pflow.fr et bientôt PFlow Bots servent ton activité. Ce n'est pas qu'un sujet PFlow Bots : le CRM est
  déjà concerné aujourd'hui.
- **12 fonctions serveur au plus** par déploiement sur Hobby : le CRM est **exactement à 12** (constaté le
  7 novembre : le déploiement d'une 13e a été refusé, contourné par une réécriture vers `pont.js`). Chaque
  nouvelle fonction du CRM demandera la même astuce.
- Autres limites gênantes de Hobby : journaux gardés **1 heure** (on l'a vu pendant les tests WhatsApp),
  tâches planifiées **une fois par jour** au plus, arrêt dur quand une limite est atteinte.
- PFlow Bots (Next.js) n'a pas le problème des 12 fonctions (Next les regroupe), mais il a les autres.

## Les deux options

| | **Vercel Pro** | **Edge Functions Supabase** |
|---|---|---|
| Coût | **20 $ / mois par membre** de l'équipe (toi seul : 20 $), plus l'usage au-delà des quotas (très large pour ton volume). Couvre **les 3 projets** de l'équipe « pflow » (CRM, site, PFlow Bots). | Inclus dans Supabase (100 fonctions par projet en gratuit). Mais Supabase en gratuit met un projet en pause après une semaine d'inactivité, et n'a pas de sauvegardes quotidiennes : la **Pro à 25 $/mois** sera vite nécessaire pour un usage commercial sérieux. |
| Usage commercial | Autorisé. | Autorisé. |
| Limites | Plus de limite de 12 fonctions ; journaux plus longs ; tâches planifiées à la minute ; fonctions jusqu'à plusieurs minutes. | Deno (pas Node) ; **CPU très court par requête** (2 s, voire 200 ms selon une page récente de Supabase) ; 150 s (gratuit) ou 400 s (payant) de durée ; 256 Mo de mémoire. |
| Travail | **Zéro ligne de code** : changer de plan dans Vercel (Settings → Billing). | **Énorme** : réécrire en Deno les 12 fonctions Node du CRM (Stripe, SumUp, UChat, Instagram, livraison) et les routes de PFlow Bots ; les rendus d'images et de réels Instagram (satori, resvg, Playwright, jusqu'à 300 s) ne tiennent pas dans ces limites ; l'interface Next.js de PFlow Bots ne peut pas y tourner du tout. |
| Risque | Aucun : même code, même adresses. | Élevé : migration de tout ce qui marche aujourd'hui, pendant que tu prospectes. |

## Recommandation

**Passer l'équipe Vercel « pflow » en Pro (20 $/mois), avant de mettre le premier canal de PFlow Bots en
« actif ».** C'est la seule option qui :
- rend tout ton hébergement conforme (CRM compris) ;
- enlève la limite des 12 fonctions et les journaux d'une heure ;
- ne demande aucun travail ni aucune migration.

Les Edge Functions Supabase restent intéressantes pour **une petite fonction isolée** (ex. un webhook très
court), mais pas comme hébergement principal. Le webhook WhatsApp de PFlow Bots est déjà isolé
(`src/channels/`) : on pourra le déplacer un jour si besoin, sans urgence.

À vérifier sur vercel.com/pricing au moment de payer (les tarifs bougent) : prix du siège Pro et quotas
inclus. Pour Supabase : passer en Pro (25 $/mois) quand le premier resto est en production sur PFlow Bots,
pour les sauvegardes quotidiennes.

Sources (7 novembre 2026) : [limites des Edge Functions (Supabase)](https://supabase.com/docs/guides/functions/limits),
[limites de CPU (Supabase)](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits),
[tarifs Vercel 2026 (résumé tiers)](https://temps.sh/blog/vercel-pricing-2026-pro-plan-explained) ; le refus
« No more than 12 Serverless Functions… on the Hobby plan » a été vu sur le vrai déploiement du CRM.
