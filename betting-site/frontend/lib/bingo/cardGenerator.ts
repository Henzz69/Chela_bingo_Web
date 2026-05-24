/**
 * cardGenerator.ts — Pure Bingo card generation logic.
 *
 * Generates a standard 5×5 American Bingo card with columns:
 *   B (1–15), I (16–30), N (31–45), G (46–60), O (61–75)
 *
 * The center cell (N column, row index 2) is the FREE space (value 0).
 *
 * No database logic — this is a pure utility.
 */

// ── Types ────────────────────────────────────────────────────

/** Column labels in standard Bingo order */
export const BINGO_COLUMNS = ['B', 'I', 'N', 'G', 'O'] as const;
export type BingoColumn = (typeof BINGO_COLUMNS)[number];

/** The structured grid output: each column holds exactly 5 numbers */
export interface BingoGrid {
  B: [number, number, number, number, number];
  I: [number, number, number, number, number];
  N: [number, number, number, number, number]; // index 2 is 0 (FREE)
  G: [number, number, number, number, number];
  O: [number, number, number, number, number];
}

// ── Column ranges ────────────────────────────────────────────

const COLUMN_RANGES: Record<BingoColumn, { min: number; max: number }> = {
  B: { min: 1, max: 15 },
  I: { min: 16, max: 30 },
  N: { min: 31, max: 45 },
  G: { min: 46, max: 60 },
  O: { min: 61, max: 75 },
};

// ── Helpers ──────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle (in-place, returns same array).
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick `count` unique random numbers from [min, max] inclusive.
 */
function pickUnique(min: number, max: number, count: number): number[] {
  const pool: number[] = [];
  for (let n = min; n <= max; n++) pool.push(n);
  shuffle(pool);
  return pool.slice(0, count);
}

// ── Main generator ───────────────────────────────────────────

/**
 * Generate a single, valid 5×5 Bingo card.
 *
 * Returns a structured `BingoGrid` object where each column key
 * maps to a 5-element tuple. The N column's center (index 2) is
 * always 0, representing the FREE space.
 *
 * @example
 * ```ts
 * const card = generateBingoCard();
 * // card.B → [4, 11, 2, 15, 7]
 * // card.N → [33, 42, 0, 31, 44]  ← index 2 is FREE
 * ```
 */
export function generateBingoCard(): BingoGrid {
  const grid: Record<string, number[]> = {};

  for (const col of BINGO_COLUMNS) {
    const { min, max } = COLUMN_RANGES[col];

    if (col === 'N') {
      // N column: pick 4 numbers, insert FREE (0) at index 2
      const nums = pickUnique(min, max, 4);
      grid[col] = [nums[0], nums[1], 0, nums[2], nums[3]];
    } else {
      // Standard column: pick 5 unique numbers
      grid[col] = pickUnique(min, max, 5);
    }
  }

  return grid as unknown as BingoGrid;
}
