/**
 * Le ticket de commande de la charte (élément récurrent) : fond crème, texte nuit, bord inférieur dentelé
 * (demi-cercles de 22 px), légère rotation, ombre plate. Purement décoratif.
 */
const DENTS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='11'%3E%3Cpath d='M0 0H22A11 11 0 0 1 0 0Z' fill='%23f3eee6'/%3E%3C/svg%3E\")";

export function Ticket({ numero, lignes, heure, className = "" }: { numero: string; lignes: string[]; heure?: string; className?: string }) {
  return (
    <div className={`w-[280px] -rotate-3 [filter:drop-shadow(8px_10px_0_rgb(0_0_0/0.28))] ${className}`} aria-hidden>
      <div className="rounded-t-md bg-creme px-5 pt-5 pb-3 text-nuit">
        <p className="flex items-baseline justify-between gap-3 font-title text-2xl uppercase">
          Nouvelle commande <span className="text-[#c8157f]">{numero}</span>
        </p>
        <hr className="my-3 border-t-2 border-dashed border-nuit/30" />
        <ul className="space-y-1 text-sm font-bold">
          {lignes.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {heure && <p className="mt-1 text-right text-sm font-bold">{heure}</p>}
        <hr className="my-3 border-t-2 border-dashed border-nuit/30" />
        <span className="inline-flex rounded-full bg-nuit px-3 py-1 text-xs font-extrabold text-white">✓ Reçue sur WhatsApp</span>
      </div>
      <div className="h-[11px] bg-repeat-x" style={{ backgroundImage: DENTS }} />
    </div>
  );
}
