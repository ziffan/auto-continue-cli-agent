// Tipe pesan + codec NDJSON untuk IPC CLI↔daemon (ADR-015). Pure — tak ada I/O socket di sini,
// supaya framing bisa diuji tanpa net nyata.

export interface IpcRequest {
  id: string;
  cmd: string;
  args?: unknown;
}

export type IpcResponse = { id: string; ok: true; data: unknown } | { id: string; ok: false; error: string };

/** Serialize satu pesan jadi satu baris NDJSON (`\n`-terminated). */
export function encodeLine(obj: IpcRequest | IpcResponse): string {
  return JSON.stringify(obj) + '\n';
}

/**
 * Decoder baris NDJSON stateful. `push()` menerima potongan chunk (Buffer/string) apa adanya
 * dari socket — bisa kurang dari satu baris, bisa berisi beberapa baris sekaligus — dan
 * mengembalikan array string JSON baris yang sudah lengkap (newline ditemukan). Sisa yang
 * belum genap satu baris tetap di-buffer untuk `push()` berikutnya.
 */
export function createLineDecoder(): { push(chunk: Buffer | string): string[] } {
  let buffer = '';
  return {
    push(chunk: Buffer | string): string[] {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? ''; // sisa setelah `\n` terakhir → belum lengkap, simpan
      return parts.filter((line) => line.length > 0);
    },
  };
}
