# Réponses de l'IA des restos : plus courtes, puis « Commander » (21 novembre 2026)

## Cas réel (Mexico, samedi 21 novembre, 21 h 34 UTC)
« Vous avez de l'agneau ce soir » →
« 🐑 *Oui !* L'agneau est disponible *le vendredi, le samedi et le dimanche* : bowl, burrito et quesadillas.
Nous sommes samedi, donc il est bien au menu ce soir. Une petite envie ? 😋 », puis « ✨ Besoin d'un petit coup de
main ? … » (Me conseiller / Infos pratiques).

**Pourquoi ce deuxième message** : la question est arrivée pendant que l'Accueil attendait un clic. Le moteur fait
répondre l'IA, puis **renvoie le bloc en attente** (la dernière bulle à boutons de l'Accueil). L'IA avait choisi
« repondre » et non la fonction proposer_commande.

## Ce qui change (bots des restos seulement)
1. **Bloc « Style des réponses »** ajouté au prompt, prioritaire sur la consigne de l'agent (qui reste telle quelle en
   base, commune aux restos et aux démos) : 1 à 2 phrases ; jamais « nous sommes samedi » sauf si le client le
   demande (l'IA connaît toujours la date et l'heure, pour répondre juste) ; pas de question ni d'invitation à
   commander en fin de réponse ; exemple de l'agneau.
2. **Nouveau champ de la réponse de l'IA, « sujet »** (« carte » ou « autre »), imposé par le schéma de sortie :
   - « carte » (carte, produit, disponibilité, prix) : la réponse, puis « Pour commander, c'est par ici 👇 » avec le
     bouton lien **Commander** vers la page du resto. Le bloc en attente n'est pas renvoyé (ses boutons déjà
     envoyés marchent toujours) ;
   - « autre » (horaires, infos pratiques, question générale) : comme avant, « Besoin d'un petit coup de main ? ».
3. **Inchangé** : démos (PFlow Démo / Mint Bun : ni bloc de style, ni bouton ajouté), transferts vers l'équipe,
   fonctions (proposer_commande garde son propre message), « ⭐ Me conseiller », allergènes.

## Tests
`src/data/__tests__/ia-reponses.test.ts` : agneau un samedi et un mardi (date reçue par l'IA, bouton Commander, pas
de « coup de main »), horaires (« coup de main » gardé), prix (Commander), réponse sans sujet (comme avant),
transfert, démo inchangée, schéma. `src/ai/__tests__/ai.test.ts` : lecture du sujet, ordre des blocs du prompt.

## IA réelle
La Preview n'a aucune variable (toutes sont « Production » seulement) : son simulateur tourne sans Claude. Pour
voir les vraies réponses sur la Preview, cocher « Preview » sur `ANTHROPIC_API_KEY` dans Vercel, puis redéployer
la Preview.
