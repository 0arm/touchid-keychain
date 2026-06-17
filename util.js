import { readFileSync, existsSync } from 'node:fs'

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
