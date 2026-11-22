/**
 * Carte et infos de Mint Bun, le resto fictif de la démo permanente PFlow (smash burgers & matcha). Copie de la carte
 * de la page de démonstration du CRM (Pflow-Crm, repo/img/demo/mint-bun/carte.json, 22 novembre 2026) : mêmes produits,
 * mêmes prix. À mettre à jour ensemble. Les infos pratiques (adresse, livraison) sont fictives mais crédibles ;
 * horaires, retrait, livraison à 3 € et paiement sur place reprennent la page de commande de la démo.
 */
export interface MintBunProduit {
  nom: string;
  categorie: "Burgers" | "Sides" | "Matcha & drinks" | "Desserts" | "Formules";
  prix: number;
  description?: string;
}

export const MINT_BUN_CARTE: MintBunProduit[] = [
  { nom: "Mint Classic", categorie: "Burgers", prix: 12.9, description: "Le best-seller. Double steak smash, cheddar fondant, laitue, pickles, oignons rouges, sauce signature." },
  { nom: "Truffle Melt", categorie: "Burgers", prix: 14.5, description: "Double steak smash, cheddar, oignons confits, roquette, mayo truffée." },
  { nom: "Spicy Matcha", categorie: "Burgers", prix: 13.9, description: "Double steak smash, cheddar, jalapeños, sauce spicy mayo, pickles." },
  { nom: "Green Veggie", categorie: "Burgers", prix: 12.5, description: "Galette végétale, cheddar, laitue, avocat, oignons rouges, sauce green." },
  { nom: "Frites maison", categorie: "Sides", prix: 4.5 },
  { nom: "Loaded fries cheddar", categorie: "Sides", prix: 6.9 },
  { nom: "Mozza sticks", categorie: "Sides", prix: 5.9 },
  { nom: "Coleslaw matcha", categorie: "Sides", prix: 3.9 },
  { nom: "Matcha latte glacé", categorie: "Matcha & drinks", prix: 5.5 },
  { nom: "Strawberry matcha", categorie: "Matcha & drinks", prix: 6 },
  { nom: "Vanilla matcha cloud", categorie: "Matcha & drinks", prix: 6.5 },
  { nom: "Citronnade maison", categorie: "Matcha & drinks", prix: 4.5 },
  { nom: "Soda / eau", categorie: "Matcha & drinks", prix: 2.5 },
  { nom: "Matcha cookie", categorie: "Desserts", prix: 3.5 },
  { nom: "Brookie chocolat", categorie: "Desserts", prix: 4.5 },
  { nom: "Soft serve matcha-vanille", categorie: "Desserts", prix: 4.9 },
  { nom: "Burger + frites + boisson", categorie: "Formules", prix: 16.9, description: "Le burger de votre choix, frites maison et une boisson." },
  { nom: "Burger + loaded fries + boisson", categorie: "Formules", prix: 18.9, description: "Le burger de votre choix, loaded fries cheddar et une boisson." },
  { nom: "Matcha break (boisson + dessert)", categorie: "Formules", prix: 8.9, description: "Une boisson matcha et un dessert." },
];

const euros = (prix: number) => `${prix.toFixed(2).replace(".", ",")} €`;
const produit = (nom: string) => {
  const p = MINT_BUN_CARTE.find((x) => x.nom === nom);
  if (!p) throw new Error(`Produit absent de la carte Mint Bun : ${nom}`);
  return p;
};
/** « 🍔 *Mint Classic* : 12,90 €\nLe best-seller… » : nom en gras et prix exact de la carte. */
const ligne = (emoji: string, nom: string, phrase: string) => `${emoji} *${nom}* : ${euros(produit(nom).prix)}\n${phrase}`;

/** « ⭐ Me conseiller » de la démo : 3 choix (WhatsApp : 3 boutons au plus), chacun 2 ou 3 vrais produits avec leur prix. */
export const MINT_BUN_CONSEILS = {
  burgers: {
    titre: "🍔 Burgers",
    texte: [
      ligne("🍔", "Mint Classic", "Notre best-seller : double steak smash, cheddar fondant et sauce signature."),
      ligne("🌶️", "Spicy Matcha", "Jalapeños et spicy mayo, pour ceux qui aiment quand ça pique."),
      ligne("🍟", "Burger + frites + boisson", "La formule : le burger de votre choix, frites maison et une boisson."),
    ].join("\n\n"),
  },
  matcha: {
    titre: "🍵 Matcha & desserts",
    texte: [
      ligne("🍵", "Matcha latte glacé", "Le classique de la maison, bien frais."),
      ligne("🍪", "Matcha cookie", "Moelleux au cœur, parfait avec un latte."),
      ligne("✨", "Matcha break (boisson + dessert)", "La formule : une boisson matcha et un dessert."),
    ].join("\n\n"),
  },
  surprise: {
    titre: "🎲 Surprenez-moi",
    texte: [
      ligne("🔥", "Truffle Melt", "Oignons confits, roquette et mayo truffée : le plus gourmand."),
      ligne("🧀", "Loaded fries cheddar", "Des frites généreuses nappées de cheddar."),
      ligne("🍓", "Strawberry matcha", "Fraise et matcha, pour finir en douceur."),
    ].join("\n\n"),
  },
} as const;

/** « ℹ️ Infos pratiques » de la démo : fictives mais crédibles (resto fictif). */
export const MINT_BUN_INFOS = {
  horaires: "🕒 *Nos horaires*\nTous les jours : 11h30 – 14h30 et 18h – 22h",
  livraison:
    "🛵 *Livraison*\nBaie-Mahault, Jarry, Les Abymes et Pointe-à-Pitre : 3 € de frais, livrée en 30 à 45 min.\n\n🏪 *Retrait sur place*\n📍 12 rue des Flamboyants, Destrellan, Baie-Mahault\n_Adresse fictive : Mint Bun est le resto de démonstration de PFlow._",
  paiement: "💳 *Paiement*\nSur place : espèces ou carte bancaire, au retrait ou à la livraison.",
} as const;
