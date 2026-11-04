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
}

export interface Db extends DbReader {
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
