// Waktu internal = epoch ms UTC (number). Jangan Date naif untuk penyimpanan (CONVENTIONS.md).

export const nowMs = (): number => Date.now();
