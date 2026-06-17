#!/usr/bin/env node
// touchenv — keychain-aware dotenvx.
//
// Forwards every argument straight to the real dotenvx, but first injects
// DOTENV_PRIVATE_KEY from the macOS Keychain (one Touch ID prompt) when opted in.
// dotenvx stays 100% vanilla; this is just a thin front door.
//
//   touchenv decrypt
//   touchenv run --convention=nextjs -- next dev
//
// Zero config by convention: service = "<package name>-dotenv", account =
// "DOTENV_PRIVATE_KEY", opt-in gate = DOTENV_USE_KEYCHAIN. Override any of them
// with a "touchid-keychain" field in the project's package.json:
//   { "touchid-keychain": { "service": "...", "account": "...", "gate": "..." } }
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Keychain } from './index.js'
import { isEnabled } from './util.js'

let pkg = {}
try {
  pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
} catch {
  // no package.json here — fall back to directory-name convention
}

const cfg = pkg['touchid-keychain'] || {}
const projectName = pkg.name ? pkg.name.split('/').pop() : basename(process.cwd())
const service = cfg.service || `${projectName}-dotenv`
const account = cfg.account || 'DOTENV_PRIVATE_KEY'
const gate = cfg.gate || 'DOTENV_USE_KEYCHAIN'

const env = { ...process.env }
if (isEnabled(gate)) {
  try {
    env[account] = await new Keychain({ service }).get(account)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  }
}

// Prefer the project-local dotenvx; fall back to one on PATH (global install).
const localDotenvx = join(process.cwd(), 'node_modules', '.bin', 'dotenvx')
const dotenvx = existsSync(localDotenvx) ? localDotenvx : 'dotenvx'

const child = spawn(dotenvx, process.argv.slice(2), { stdio: 'inherit', env })
child.on('error', err => {
  const why = err.code === 'ENOENT' ? 'dotenvx not found (install it in the project or globally)' : err.message
  process.stderr.write(`touchenv: ${why}\n`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
