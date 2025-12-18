// ATTACK 20: Prototype Chain Attack
// Goal: Pollute prototypes to affect all objects

// Indirect __proto__ access
const protoKey = ['__', 'proto', '__'].join('')

// Pollution via Object.assign
export function merge(target: object, source: object): object {
  // Looks safe but can pollute if source has __proto__
  return Object.assign(target, source)
}

// Pollution via JSON parse
export function parseUnsafe(json: string): unknown {
  // JSON.parse can create objects with __proto__
  return JSON.parse(json)
}

// Pollution via spread
export function spread(obj: Record<string, unknown>): object {
  // Spread can copy polluted properties
  return { ...obj }
}

// Constructor pollution
export function polluteCtor(value: unknown): void {
  const obj = {} as Record<string, unknown>
  obj['constructor'] = { prototype: { polluted: value } }
}

// Symbol pollution (less obvious)
const adminSymbol = Symbol.for('isAdmin')

export function checkAdmin(user: object): boolean {
  // Can be bypassed by setting symbol property
  return (user as Record<symbol, boolean>)[adminSymbol] === true
}

// Getter/setter pollution
export function createAccessor(obj: object, prop: string, value: unknown): void {
  Object.defineProperty(obj, prop, {
    get() { return value },
    set() { /* ignored */ },
    configurable: true
  })
}

// Looks innocent
export function helper(x: number): number {
  return x + 1
}
