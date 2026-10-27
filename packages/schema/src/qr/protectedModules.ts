// Function-region occupancy from ISO/IEC 18004, used only to protect the
// encoder's existing modules from decoration. This never encodes or masks data.
const ALIGNMENT = [
  [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42],
  [6,26,46], [6,28,50], [6,30,54], [6,32,58], [6,34,62], [6,26,46,66],
  [6,26,48,70], [6,26,50,74], [6,30,54,78], [6,30,56,82], [6,30,58,86],
  [6,34,62,90], [6,28,50,72,94], [6,26,50,74,98], [6,30,54,78,102],
  [6,28,54,80,106], [6,32,58,84,110], [6,30,58,86,114], [6,34,62,90,118],
  [6,26,50,74,98,122], [6,30,54,78,102,126], [6,26,52,78,104,130],
  [6,30,56,82,108,134], [6,34,60,86,112,138], [6,30,58,86,114,142],
  [6,34,62,90,118,146], [6,30,54,78,102,126,150], [6,24,50,76,102,128,154],
  [6,28,54,80,106,132,158], [6,32,58,84,110,136,162], [6,26,54,82,110,138,166],
  [6,30,58,86,114,142,170],
];

export function protectedModules(version: number): boolean[][] {
  const n = 17 + 4 * version;
  const mask = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const rect = (x: number, y: number, width: number, height: number) => {
    for (let row = Math.max(0, y); row < Math.min(n, y + height); row++) {
      for (let col = Math.max(0, x); col < Math.min(n, x + width); col++) mask[row][col] = true;
    }
  };
  // Finder, separator and adjacent format regions. Preserve the encoder's
  // exact dark/light values; do not invent finder artwork.
  rect(0, 0, 9, 9); rect(n - 8, 0, 8, 9); rect(0, n - 8, 9, 8);
  rect(6, 0, 1, n); rect(0, 6, n, 1);
  rect(8, 0, 1, n); rect(0, 8, n, 1);
  if (version >= 7) { rect(n - 11, 0, 3, 6); rect(0, n - 11, 6, 3); }
  const centers = ALIGNMENT[version - 1] ?? [];
  for (const y of centers) for (const x of centers) {
    if ((x === 6 && (y === 6 || y === n - 7)) || (y === 6 && x === n - 7)) continue;
    rect(x - 2, y - 2, 5, 5);
  }
  return mask;
}

export interface AvatarPlacement { x: number; y: number; side: number; padding: number }
export function avatarPlacement(mask: boolean[][], fraction: number): AvatarPlacement | null {
  const n = mask.length;
  if (!Number.isFinite(fraction) || fraction <= 0) return null;
  const desired = Math.max(1, Math.floor(n * Math.min(fraction, 0.12)));
  for (let side = desired; side >= Math.max(1, desired - 2); side--) {
    const origin = Math.floor((n - side) / 2);
    for (const [dx, dy] of [[0, 0], [-desired, 0], [desired, 0], [0, -desired], [0, desired]]) {
      const x = origin + dx; const y = origin + dy; const padding = 1;
      let safe = x > padding && y > padding && x + side + padding < n && y + side + padding < n;
      for (let row = y - padding; safe && row < y + side + padding; row++) {
        for (let col = x - padding; col < x + side + padding; col++) {
          if (mask[row]?.[col] !== false) { safe = false; break; }
        }
      }
      if (safe) return { x, y, side, padding };
    }
  }
  return null;
}
