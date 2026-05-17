// ============================================================
// Types
// ============================================================
export type WinPattern = 'row' | 'column' | 'diagonal' | 'four_corners' | 'full_house';

export const COLUMNS = ['B', 'I', 'N', 'G', 'O'];

// ============================================================
// Deterministic Card Generator (Room Seed Based)
// ============================================================

// Helper: Convert a string seed (like Room ID) into a numeric seed for Mulberry
function stringToSeed(str: string): number {
  let h = 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
  }
  return (h ^ h >>> 16) >>> 0;
}

// Seeded pseudo-random (mulberry32)
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const COL_RANGES = [
  [1, 15],   // B
  [16, 30],  // I
  [31, 45],  // N
  [46, 60],  // G
  [61, 75],  // O
];

// Main function: Generate Card #N for a given game seed (Room ID)
export const generateDeterministicCard = (gameSeed: string, cardIndex: number): number[] => {
  // Combine the room seed with the specific card index to get a unique hash
  const numericSeed = stringToSeed(`${gameSeed}-card-${cardIndex}`);
  const rng = mulberry32(numericSeed);
  
  const card = new Array(25).fill(0);
  
  COL_RANGES.forEach(([min, max], colIdx) => {
    const pool: number[] = [];
    for (let n = min; n <= max; n++) pool.push(n);
    const shuffled = seededShuffle(pool, rng).slice(0, 5);
    for (let row = 0; row < 5; row++) {
      card[row * 5 + colIdx] = shuffled[row];
    }
  });
  
  card[12] = 0; // 12th index is FREE cell
  return card;
};

export function columnLetter(num: number): string {
  if (num === 0) return 'FREE';
  if (num >= 1 && num <= 15) return 'B';
  if (num >= 16 && num <= 30) return 'I';
  if (num >= 31 && num <= 45) return 'N';
  if (num >= 46 && num <= 60) return 'G';
  return 'O';
}

// Win pattern check
const WIN_LINES = {
  rows: [[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24]],
  cols: [[0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24]],
  diags: [[0,6,12,18,24],[4,8,12,16,20]],
  corners: [0,4,20,24],
};

export function checkWin(card: number[], daubed: Set<number>, drawn: Set<number>): { won: boolean; line?: number[] } {
  const eff = new Set(daubed);
  eff.add(12); // FREE always daubed

  // Validate daubed cells
  for (const idx of eff) {
    const n = card[idx];
    if (n !== 0 && !drawn.has(n)) return { won: false };
  }

  const all = (line: number[]) => line.every(i => eff.has(i));

  for (const line of WIN_LINES.rows) if (all(line)) return { won: true, line };
  for (const line of WIN_LINES.cols) if (all(line)) return { won: true, line };
  for (const line of WIN_LINES.diags) if (all(line)) return { won: true, line };
  if (all(WIN_LINES.corners)) return { won: true, line: WIN_LINES.corners };
  // Check full house (25 cells minus the free one)
  if (eff.size === 25) return { won: true };

  return { won: false };
}