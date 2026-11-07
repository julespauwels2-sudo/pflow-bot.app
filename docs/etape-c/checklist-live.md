# Passer l'app PFlow Bots en mode « Live »

Mis à jour le 7 novembre 2026. ⚠️ Écrit sans accès direct au tableau de bord de Meta (bloqué depuis ma
session) : les intitulés peuvent légèrement varier (français / anglais entre parenthèses).

## Pourquoi maintenant

`subscribed_apps` est correct (PFlow Bots est abonnée au compte de test), mais l'encadré de Meta l'indique :
**tant que l'app n'est pas publiée, elle ne reçoit que les webhooks de test** (le bouton « Tester »). Les
deux appels vus le 7 novembre à 04 h 12 et 04 h 23 UTC étaient ce message d'exemple (identifiant
`ABGGFlA5Fpa`), pas un vrai message. → Passer en Live pour recevoir les vrais messages.

## Étape 0 — avant Meta (≈ 5 min)

1. **Fusionner la PR des pages légales** : https://github.com/julespauwels2-sudo/Site-PFlow/pull/3
   (Vercel publie pflow.fr tout seul).
2. Ouvrir en **navigation privée** et vérifier que les deux pages s'affichent :
   - https://www.pflow.fr/confidentialite
   - https://www.pflow.fr/suppression-donnees
   Meta vérifie que l'URL de confidentialité répond : si elle ne s'ouvre pas, le passage en Live est refusé.
3. **Vercel → projet `pflow-bot-app` → Settings → Environment Variables → Add** :
   - Nom : `CRON_SECRET`
   - Valeur : une longue phrase aléatoire (gestionnaire de mots de passe, 32 caractères ou plus)
   - Environnement : **Production** uniquement ; cocher **Sensitive** → **Save**
   - Puis **Deployments → dernier déploiement → ⋯ → Redeploy**.
   - Contrôle : la page **État** de PFlow Bots affiche `CRON_SECRET` comme présente. C'est ce qui active la
     suppression automatique promise par la page de confidentialité (12 mois / 30 jours).

## Étape 1 — Paramètres de l'app → Général (*App settings → Basic*)

developers.facebook.com → **Mes apps** → **PFlow Bots** → menu de gauche **Paramètres de l'app** →
**Général**. Les champs, dans l'ordre de la page :

| # | Champ (FR / EN) | Quoi mettre |
|---|---|---|
| 1 | **ID de l'app** / **Clé secrète** (*App ID / App secret*) | Ne rien toucher. Ne pas réinitialiser la clé secrète : elle est dans Vercel (`WHATSAPP_APP_SECRET`) |
| 2 | **Nom d'affichage** (*Display name*) | `PFlow Bots` (déjà rempli) |
| 3 | **Espace de noms** (*Namespace*) | Laisser vide |
| 4 | **Domaines de l'app** (*App domains*) | `pflow.fr` (taper puis Entrée : il devient une étiquette) |
| 5 | **E-mail de contact** (*Contact email*) | `jules.pauwels2@gmail.com` |
| 6 | **URL de la politique de confidentialité** (*Privacy policy URL*) — **obligatoire** | `https://www.pflow.fr/confidentialite` |
| 7 | **URL des conditions de service** (*Terms of Service URL*) | `https://www.pflow.fr/cgv` |
| 8 | **Suppression des données utilisateur** (*User data deletion*) — **obligatoire** | Menu déroulant : **URL des instructions de suppression des données** (*Data deletion instructions URL*), puis `https://www.pflow.fr/suppression-donnees`. Ne pas choisir « URL de rappel » (*callback*) : elle ne sert qu'à Facebook Login |
| 9 | **Icône de l'app (1024 × 1024)** (*App icon*) — **obligatoire** | Cliquer sur le carré de l'icône → importer `docs/etape-c/meta/icone-pflow-bots-1024.png` (PNG 1024 × 1024, le « P » du site) |
| 10 | **Catégorie** (*Category*) — **obligatoire** | **Messagerie** (*Messaging*) ; à défaut **Entreprises et pages** (*Business and pages*) |
| 11 | Sous-catégorie, si Meta en demande une | La plus proche de « messagerie professionnelle / service client » |
| 12 | **Vérification de l'entreprise** (*Business verification*) | Pas nécessaire pour le Live. Ce sera nécessaire plus tard pour les vrais numéros (checklist C0) |

→ En bas de la page : **Enregistrer les modifications** (*Save changes*). S'il reste un champ en rouge, Meta
l'indique en haut de la page.

## Étape 2 — Autorisations (à vérifier, normalement rien à faire)

Menu **Examen de l'app** → **Autorisations et fonctionnalités** (*App Review → Permissions and Features*) :
`whatsapp_business_messaging` et `whatsapp_business_management` en **accès standard** suffisent pour tes
propres comptes WhatsApp. ⚠️ Si Meta exige l'**accès avancé** (*Advanced access*) ou un **examen**
avant le passage en Live, **arrête-toi et dis-le-moi**.

## Étape 3 — Publier

1. Menu de gauche **Publier** (*Publish*), ou en haut de la page **Mode de l'app : Développement → Live**
   (*App mode: Development → Live*).
2. Meta affiche la liste de ce qui manque. Si tout est vert : **Publier** / **Passer en Live** → confirmer.
3. Si Meta demande la **vérification des données** (*Data Use Checkup*) : répondre que les données servent
   uniquement à répondre aux clients qui écrivent au resto (pas de publicité, pas de revente) et confirmer.

## Étape 4 — Vérifier (≈ 2 min)

1. Écrire **« Bonjour »** au **+1 555 186 2679** depuis le +590 690 93 81 08.
2. Me prévenir tout de suite : je lis les journaux Vercel. Ils ne sont gardés qu'une heure sur l'offre
   gratuite. On doit y voir `[whatsapp] reçu : 1 message(s) ; traités : 1`.
3. Page **État** : un événement reçu ; **Boîte de réception** : la conversation.

## Ce que la publication change, et ne change pas

- **Change** : l'app PFlow Bots reçoit les vrais messages des comptes qui lui sont reliés. Aujourd'hui,
  seulement le **Test WhatsApp Account** (l'utilisateur système `pflow-bots-serveur` n'a accès qu'à lui).
- **Ne change rien pour les numéros des clients sur UChat** : ils sont reliés à l'app Meta d'UChat, pas à
  PFlow Bots. Le mode d'une app ne concerne que cette app.
- **Ne change rien pour tes autres apps Meta** (dont l'app des mots-clés Instagram et son examen en cours).
- **Réversible** : on peut repasser l'app en Développement à tout moment (webhook et réglages conservés).
