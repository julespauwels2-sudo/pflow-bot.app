# « ⭐ Me conseiller » avec des boutons (10 novembre 2026)

## Le parcours

1. Le client clique sur « ⭐ Me conseiller » (Accueil) : le bot envoie les **choix du jour** et « 🎲 Surprenez-moi ».
   - 3 choix au plus (Surprenez-moi compris) : **boutons de réponse** (titres de 20 caractères au plus) ;
   - au-delà : **liste interactive** WhatsApp (« Voir les choix », 10 lignes au plus, titres de 24 caractères).
2. Au clic (ou si le client tape le choix, ex. « poulet ») : l'IA recommande **2 ou 3 produits** de ce choix, nom en
   gras et prix exact de la carte, sans proposer un produit indisponible ce jour-là. Consigne dédiée, aucune fonction.
3. Puis « 🛒 Commander » (lien vers la page de commande) et « 🔄 Autre chose » (renvoie les choix).

Marche en mode **mots-clés uniquement** (Mexico, AG Pizza) : le clic sur « Me conseiller » ouvre une conversation, et
les clics suivants restent dans cette conversation. Sans IA (clé absente, plafond du jour) : la page de commande et
« Autre chose », sans transfert. Une vraie question tapée à ce moment reste une question libre pour l'IA.

## D'où viennent les choix

- **Automatique** : une famille par catégorie de la carte du CRM (ordre de la carte, produits disponibles, sans les
  boissons). Une famille dont **tous** les produits ont des jours de disponibilité n'est proposée que ces jours-là.
- **Personnalisé** (remplace l'automatique) : champ « Choix de « ⭐ Me conseiller » » de la fiche du bot, une ligne
  par bouton : `Titre | précision pour l'IA | jours` (jours facultatifs : `ven sam dim`).

Pourquoi personnaliser Mexico et AG Pizza : leurs catégories CRM sont des **formats** (Burritos, Bowls…) ou une seule
catégorie (Pizzas), pas les familles voulues (Bœuf, Poulet… ; familles de pizzas). Cookies : l'automatique suffit
(« Cookies », « Box », « Surprenez-moi » = 3 boutons).

### Listes enregistrées (validées par Jules le 10 novembre 2026)

Mexico :
```
🥩 Bœuf | burrito, bowl et quesadillas au bœuf
🍗 Poulet | burrito, bowl, quesadillas et empanada au poulet
🌱 Végan | burrito végan et bowl végan
🐑 Agneau | burrito, bowl et quesadillas à l'agneau | ven sam dim
```
AG Pizza :
```
🍖 Viande | Le Raï, La Soul, Le Rap, La Salsa, La Classique
🧀 Fromage | La Jazzy, La Rock n Roll
🌱 Veggie & poisson | La Reggae (végétarienne), La Pop (saumon)
```

## Réglages

- Bloc **Agent IA** : case « Proposer des choix de la carte (boutons) » (`choixCarte`). Le message d'introduction sert
  de texte au-dessus des choix.
- Modèle (seed) : « IA - Recommandation » a l'option cochée.

## Mise en production (après fusion et déploiement)

Fait par Jules le 10 novembre 2026 (PR n° 27 fusionnée, option cochée et publiée dans « IA - Recommandation » du
modèle maître). Listes de Mexico et d'AG Pizza enregistrées dans `bot_fiches` (champ `conseilChoix`, les autres
champs de la fiche inchangés).

## Limites

- **Lien direct vers le produit** : impossible pour l'instant, la page de commande du CRM ne lit aucun paramètre
  produit. Le bouton ouvre la page de commande du resto. PR CRM séparée prévue **après la migration du 19 au 21**
(`docs/plan.md`).
- Captures : prises dans le simulateur en mode local (vraie carte et vrais flux du modèle, aucune écriture en base) ;
  les réponses de l'IA y sont **simulées** (pas de clé Claude dans la session), écrites à partir de la vraie carte.
  À revérifier dans le simulateur avec « IA réelle ».
