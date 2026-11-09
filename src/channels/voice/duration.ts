/**
 * Durée d'un message vocal, lue dans le fichier, sans service extérieur.
 * Les vocaux WhatsApp sont en Ogg Opus : la position de la dernière page (« granule », toujours à 48 kHz pour Opus),
 * moins le « pre-skip » de l'en-tête OpusHead, donne la durée exacte. Autres formats : inconnue (null).
 */
export function audioDurationSeconds(data: Uint8Array, mimeType: string): number | null {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  if (type !== "audio/ogg" && type !== "audio/opus" && !(data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Dernière page « OggS » : on remonte depuis la fin.
  for (let i = data.length - 27; i >= 0; i--) {
    if (data[i] !== 0x4f || data[i + 1] !== 0x67 || data[i + 2] !== 0x67 || data[i + 3] !== 0x53) continue;
    const lo = view.getUint32(i + 6, true);
    const hi = view.getUint32(i + 10, true);
    // -1 (tous les bits à 1) : aucune position sur cette page.
    if (hi === 0xffffffff && lo === 0xffffffff) return null;
    const granule = hi * 2 ** 32 + lo;
    if (granule <= 0) return null;
    return Math.max(0, (granule - opusPreSkip(data, view)) / 48_000);
  }
  return null;
}

/** « Pre-skip » de l'en-tête OpusHead (échantillons à ignorer au début), 0 s'il est absent. */
function opusPreSkip(data: Uint8Array, view: DataView): number {
  const head = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // « OpusHead »
  const limit = Math.min(data.length - 12, 512);
  for (let i = 0; i < limit; i++) {
    if (head.every((b, k) => data[i + k] === b)) return view.getUint16(i + 10, true);
  }
  return 0;
}

/** « 0:23 », « 1:05 ». */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
