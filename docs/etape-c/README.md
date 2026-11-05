# Étape C (WhatsApp) — dossier de préparation

**État : préparé le 5 novembre 2026, rien d'appliqué ni de branché.** Étape en pause jusqu'à la fin
des examens de Jules (fin novembre). Tout ici est à relire et à valider avant le moindre changement.

| Document | Contenu |
|---|---|
| [checklist-c0.md](checklist-c0.md) | **À lire en premier** : tout ce qu'il faut avoir prêt avant la partie Meta, dans l'ordre, avec les temps |
| [plan.md](plan.md) | Plan détaillé de l'étape C, découpé en sous-étapes testables, décisions à prendre |
| [migration-c.sql](migration-c.sql) | Deuxième migration SQL proposée (numéros, contacts, sessions, messages…), **non appliquée** |
| [pflow-order.md](pflow-order.md) | Liste exacte des modifications à faire dans PFlow Order (dépôt `Pflow-Crm`), fichier par fichier |
| [guide-meta.md](guide-meta.md) | Guide pas à pas : app Meta, numéro de test, utilisateur système, token, webhook |
| [patches/](patches/README.md) | Les 4 modifications de PFlow Order en fichiers diff, testées sur une copie |

Règles qui restent en vigueur :
- uniquement des tables `bot_` dans la base du CRM, SQL montré avant toute migration, RLS partout ;
- le CRM reste en lecture seule pour le bot ; les modifications de PFlow Order sont montrées avant ;
- secrets dans les variables d'environnement (Vercel, `.env.local`), jamais dans Git ;
- tests sur le numéro de test Meta ou le numéro de Jules ; **on ne touche pas aux bots UChat en prod** ;
- coût proche de zéro : seuls l'API WhatsApp Cloud et l'API Claude sont payantes.

Lecture du code de PFlow Order : faite en lecture seule (clone du dépôt `Pflow-Crm`, commit `5ac768c`
du 3 novembre 2026), sans aucune modification.
