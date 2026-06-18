import { readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'

// Truthy if `name` is set to true/1/yes/on — checked in the environment first,
// then in .env.local / .env (the toggle is a plaintext flag, not a secret).
export function isEnabled(name) {
  const truthy = v => /^(true|1|yes|on)$/i.test(String(v).trim().replace(/^["']|["']$/g, ''))
  if (process.env[name] != null) return truthy(process.env[name])
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    const line = readFileSync(file, 'utf8').split('\n').find(l => l.startsWith(name + '='))
    if (line) return truthy(line.slice(name.length + 1))
  }
  return false
}

// Resolve service/account/gate from the project's package.json `touchenv` field,
// falling back to conventions: service `<pkg-name>-dotenv`, account
// DOTENV_PRIVATE_KEY, gate DOTENV_USE_KEYCHAIN.
export function resolveConfig() {
  let pkg = {}
  try {
    pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
  } catch {
    // no package.json — fall back to directory-name convention
  }
  const cfg = pkg.touchenv || {}
  const projectName = pkg.name ? pkg.name.split('/').pop() : basename(process.cwd())
  return {
    service: cfg.service || `${projectName}-dotenv`,
    account: cfg.account || 'DOTENV_PRIVATE_KEY',
    gate: cfg.gate || 'DOTENV_USE_KEYCHAIN',
  }
}
