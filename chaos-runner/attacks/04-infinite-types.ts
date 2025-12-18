// ATTACK 04: Type System Bomb
// Goal: Hang or crash TypeScript compiler in Gate 3

// Deeply recursive type that may cause compiler to hang
type DeepNest<T, D extends number = 50> =
  D extends 0 ? T : DeepNest<{ value: T }, [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49][D]>

// Circular type references
type A = { b: B; data: string }
type B = { a: A; data: number }
type C = A & B & { c: C }

// Exponential type expansion
type Expand<T> = T extends object ? { [K in keyof T]: Expand<T[K]> } : T
type Huge = Expand<Expand<Expand<Expand<{ a: { b: { c: { d: string } } } }>>>>

// Function using these types
export function processDeep(input: DeepNest<string>): Huge {
  return input as any
}

export function circular(a: A, b: B): C {
  return { ...a, ...b, c: {} as C }
}
