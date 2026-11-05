# Documents juridiques — premiers jets

**Rédigés le 5 novembre 2026, à relire par Jules.** Ce ne sont pas des documents validés : ils
servent de base de travail.

| Document | Pour qui | Où il servira |
|---|---|---|
| [politique-confidentialite.md](politique-confidentialite.md) | Clients des restos, restaurateurs, prospects | Page publique (ex. pflow.fr/confidentialite) ; **adresse exigée par Meta** pour valider l'app (WhatsApp et Instagram) |
| [clause-rgpd-sous-traitance.md](clause-rgpd-sous-traitance.md) | Chaque resto client | Article + 3 annexes à ajouter au contrat PFlow (article 28 RGPD) |

## Choix de rédaction

- **Deux rôles distincts** : PFlow est *sous-traitant* pour les données des clients des restos (le resto
  est responsable de traitement) et *responsable* pour ses propres clients, prospects et visiteurs.
- Les **engagements techniques** écrits correspondent à ce que fait le code aujourd'hui (signature des
  notifications Meta, RLS, journaux masqués, audio non conservé), **sauf les points ci-dessous**.
- Délais laissés entre crochets (`[30] jours`, `[48] heures`…) : valeurs courantes, à ajuster.

## ⚠️ À aligner AVANT de publier ou de signer

Ces documents promettent des choses qui ne sont pas encore en place. Il faut soit les faire, soit
corriger le texte :

1. **Suppression automatique après 12 mois / 30 jours** : préparée dans le code mais **pas activée**
   (`docs/securite.md`, § 5). À activer avant la mise en service du premier client.
2. **Région Vercel** : aucune région n'est réglée dans le projet, les fonctions serveur tournent donc
   probablement aux **États-Unis** (région par défaut de Vercel). Proposition : régler la région sur
   l'Europe (Dublin `dub1`, à côté de la base Supabase en Irlande, ou Paris `cdg1`). C'est une ligne de
   configuration (`preferredRegion` ou `vercel.json`) — non faite, à décider.
3. **Boîte de réception pour l'équipe du resto** : l'annexe 3 parle d'un accès de l'équipe du Client à
   ses propres conversations ; aujourd'hui seuls les admins PFlow y ont accès (gérants prévus « plus
   tard »). Adapter le texte ou la fonction.
4. **Service de transcription** : pas encore choisi (Mistral, OpenAI ou Deepgram) ; le nommer dans les
   deux documents. Mistral (France, UE) simplifierait la question des transferts.
5. **Modèle de mention d'information** promis au resto (X.3, point 2) : à rédiger (2 lignes pour le
   message d'accueil du bot + lien vers la politique).
6. **Adresse e-mail dédiée** aux demandes RGPD, SIRET et adresse : à compléter.

## ⚠️ Points de droit à trancher

- **Montage WhatsApp avec Meta** : si chaque resto a son propre compte WhatsApp Business (il accepte
  les conditions de Meta), Meta est *son* sous-traitant et PFlow intervient comme prestataire technique ;
  si PFlow héberge les numéros sous son propre compte, Meta devient sous-traitant ultérieur de PFlow.
  Le choix se fera à l'étape C (`docs/etape-c/plan.md`).
- **Paiement en ligne** (Stripe, SumUp) : ces prestataires sont souvent responsables de traitement
  distincts pour les données de paiement ; à qualifier si la politique couvre aussi le mini-site.
- **Base légale des réponses du bot** : proposé « mesures précontractuelles » (art. 6.1.b) ; l'intérêt
  légitime est une alternative.
- **IA et article 22** : le texte dit que l'assistant ne prend pas de décision produisant des effets
  juridiques ; à confirmer au regard des fonctions réelles (il ne refuse ni n'accepte de commande).
- **Obligations du règlement européen sur l'IA** (transparence des systèmes qui dialoguent avec des
  personnes) : la politique indique déjà que certaines réponses sont rédigées par une IA ; vérifier si
  un message d'accueil le disant explicitement est nécessaire.

## Faits vérifiés (sources consultées le 5 novembre 2026)

- Base Supabase du projet : région **eu-west-1 (Irlande)** — vérifié dans les réglages du projet.
- Meta, API WhatsApp Cloud : Meta agit comme **sous-traitant** de l'entreprise, messages au repos
  supprimés après 30 jours, centres de données en Amérique du Nord et dans l'UE —
  [documentation Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security).
- Vercel : certifié **Data Privacy Framework**, DPA avec clauses contractuelles types —
  [conformité Vercel](https://vercel.com/docs/security/compliance).
- Anthropic (API) : pas d'entraînement sur les données de l'API, suppression sous 30 jours d'après des
  sources secondaires (une source parle de 7 jours) — **à vérifier** sur les conditions commerciales et
  le centre de confidentialité d'Anthropic ; statut DPF non trouvé.
- Supabase : transferts encadrés par des clauses contractuelles types (source secondaire) — **à
  vérifier** dans le DPA de Supabase.
