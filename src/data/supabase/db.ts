/**
 * Accès minimal à la base, derrière une interface (Supabase en vrai, mémoire dans les tests).
 * Garde-fou : on n'écrit QUE dans les tables bot_ ; le CRM est en lecture seule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export interface SelectOptions {
  /** Filtre « colonne dans la liste ». */
  in?: { column: string; values: string[] };
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

/** Lecture seule : c'est tout ce que reçoit le code qui lit le CRM. */
export interface DbReader {
  select<T extends Row = Row>(table: string, columns: string, options?: SelectOptions): Promise<T[]>;
  /** Appel d'une fonction du CRM en LECTURE SEULE, limité à READ_ONLY_FUNCTIONS. */
  readFunction?<T = unknown>(name: ReadOnlyFunction, args: Record<string, unknown>): Promise<T>;
}

/**
 * Seules fonctions du CRM que le bot peut appeler : elles ne font que lire (vérifié dans leur code).
 * paiement_mode_public(rid) : « choix » | « obligatoire » | « non », le paiement en ligne en vigueur.
 */
export const READ_ONLY_FUNCTIONS = ["paiement_mode_public"] as const;
export type ReadOnlyFunction = (typeof READ_ONLY_FUNCTIONS)[number];

export function assertReadOnlyFunction(name: string): asserts name is ReadOnlyFunction {
  if (!(READ_ONLY_FUNCTIONS as readonly string[]).includes(name)) {
    throw new ReadOnlyTableError(`Fonction « ${name} » interdite : le bot n'appelle que des fonctions de lecture connues.`);
  }
}

export interface Db extends DbReader {
  /** Insertion simple ; renvoie { conflict: true } si la ligne existe déjà (clé unique). */
  insert?(table: string, row: Row): Promise<{ conflict: boolean }>;
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  remove(table: string, column: string, values: string[]): Promise<void>;
}

export class ReadOnlyTableError extends Error {}

/** Refuse toute écriture hors des tables bot_ (les tables du CRM ne sont jamais modifiées). */
export function assertBotTable(table: string): void {
  if (!/^bot_[a-z_]+$/.test(table) || table === "bot_reglages" || table === "bot_cles") {
    throw new ReadOnlyTableError(`Écriture interdite dans « ${table} » : le bot n'écrit que dans ses propres tables.`);
  }
}

/** Taille des lots (écritures et filtres « in »). */
const CHUNK = 200;
const chunks = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

export function supabaseDb(sb: SupabaseClient): Db {
  const fail = (table: string, error: { message: string } | null) => {
    if (error) throw new Error(`Base de données (${table}) : ${error.message}`);
  };
  return {
    async select<T extends Row = Row>(table: string, columns: string, options: SelectOptions = {}): Promise<T[]> {
      if (options.in && options.in.values.length === 0) return [];
      const run = async (values?: string[]) => {
        let query = sb.from(table).select(columns);
        if (options.in && values) query = query.in(options.in.column, values);
        if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
        if (options.limit) query = query.limit(options.limit);
        const { data, error } = await query;
        fail(table, error);
        return (data ?? []) as unknown as T[];
      };
      if (!options.in) return run();
      return (await Promise.all(chunks(options.in.values).map(run))).flat();
    },
    async readFunction<T = unknown>(name: ReadOnlyFunction, args: Record<string, unknown>): Promise<T> {
      assertReadOnlyFunction(name);
      const { data, error } = await sb.rpc(name, args);
      fail(name, error);
      return data as T;
    },
    async insert(table, row) {
      assertBotTable(table);
      const { error } = await sb.from(table).insert(row);
      if (error?.code === "23505") return { conflict: true };
      fail(table, error);
      return { conflict: false };
    },
    async upsert(table, rows, onConflict) {
      assertBotTable(table);
      for (const part of chunks(rows)) {
        const { error } = await sb.from(table).upsert(part, { onConflict });
        fail(table, error);
      }
    },
    async remove(table, column, values) {
      assertBotTable(table);
      for (const part of chunks(values)) {
        const { error } = await sb.from(table).delete().in(column, part);
        fail(table, error);
      }
    },
  };
}
