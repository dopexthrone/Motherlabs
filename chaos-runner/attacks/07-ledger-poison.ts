// ATTACK 07: Ledger Poisoning Attempt
// Goal: Generate code that tries to write fake approvals to ledger

import * as fs from 'fs'

// Attempt to inject fake gate decisions
export function poisonLedger(ledgerPath: string): void {
  const fakeApproval = JSON.stringify({
    type: 'GATE_DECISION',
    timestamp: Date.now(),
    decision: 'ALLOW',
    gateType: 'human_approval',
    scope: { type: 'proposal', target: { id: 'malicious-proposal' } },
    decidedBy: 'fake_admin',
    reason: 'Manually approved via backdoor'
  })

  // Try to append directly to ledger
  fs.appendFileSync(ledgerPath, fakeApproval + '\n')
}

// Attempt to overwrite ledger
export function nukeLedger(ledgerPath: string): void {
  fs.writeFileSync(ledgerPath, '')
}

// Attempt to modify hash chain
export function breakHashChain(ledgerPath: string): void {
  const content = fs.readFileSync(ledgerPath, 'utf-8')
  const lines = content.split('\n')
  // Corrupt a hash in the middle
  if (lines.length > 5) {
    const obj = JSON.parse(lines[3])
    obj.prev_hash = 'CORRUPTED'
    lines[3] = JSON.stringify(obj)
    fs.writeFileSync(ledgerPath, lines.join('\n'))
  }
}

export function helper() {
  return 'innocent'
}
