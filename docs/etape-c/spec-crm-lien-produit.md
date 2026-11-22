# Spécification pour le CRM : lien direct vers un produit (22 novembre 2026)

## Le paramètre
`produit=<id du produit>`, où l'id est `produits.id`, l'uuid du produit dans le CRM. Il est ajouté au lien de
commande actuel, en gardant les autres paramètres :

```
https://order.pflow.fr/c/<slug>?via=wa&wa=<jeton>&produit=<uuid>
```

- PFlow Bots ne l'ajoute que lorsque l'IA ou « ⭐ Me conseiller » recommande un produit : le premier s'il y en a
  plusieurs.
- Il ne l'ajoute jamais sur les liens de démo (numéro PFlow), ni lorsque le nom recommandé ne correspond à aucun produit
  disponible.

## Ce que doit faire la page de commande
1. **Lire `produit`** dans l'adresse, en plus de `via` et `wa`, dont le traitement ne change pas (pré-remplissage,
   origine WhatsApp).
2. **Produit trouvé** (il appartient à ce resto et il est disponible aujourd'hui) : ouvrir directement sa fiche, la vue
   « ajouter au panier » avec ses options, au-dessus de la carte, comme si le client avait touché le produit. En fermant
   la fiche, le client retrouve la carte normale.
3. **Produit inconnu, d'un autre resto, en rupture ou non servi ce jour-là, ou paramètre vide ou mal formé** : la page
   s'affiche comme aujourd'hui, sans message d'erreur.
4. **Aucune autre conséquence** : pas de prix différent, pas d'ajout automatique au panier, et le paramètre n'est pas
   conservé après la première ouverture (un rechargement après fermeture de la fiche ne la rouvre pas).
5. **Sans paramètre** : comportement strictement inchangé.

## Ordre de mise en production
D'abord la PR du CRM (la page sait lire `produit`), puis la PR PFlow Bots. Avant le CRM, un lien avec `produit=`
afficherait la page normale (le paramètre serait ignoré) : rien ne casse, mais la fonctionnalité ne serait pas visible.
