#!/usr/bin/env node
// touchenv — keychain-aware dotenvx.
//
// Default behavior is a passthrough: every command other than `keychain` is
// forwarded to dotenvx with DOTENV_PRIVATE_KEY injected from the macOS Keychain
// (Touch ID). The `keychain` group manages that stored key. Off macOS the
// keychain is skipped and this is a plain dotenvx passthrough, so it's safe in
// Linux/CI/Vercel builds where the key comes from the real environment.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { Keychain } from './index.js'
import { isEnabled, resolveConfig } from './util.js'

const argv = process.argv.slice(2)
const RESERVED = new Set(['keychain', '-h', '--help', '-V', '--version', 'help'])

if (argv.length > 0 && !RESERVED.has(argv[0])) {
  await dotenvxPassthrough(argv)
} else {
  await buildCli().parseAsync(process.argv)
}

// --- keychain-aware dotenvx passthrough ------------------------------------

async function dotenvxPassthrough(args) {
  const { service, account, gate } = resolveConfig()
  const env = { ...process.env }

  if (process.platform === 'darwin' && isEnabled(gate)) {
    try {
      const kc = new Keychain(service, { account, reason: `unlock ${account} for dotenvx` })
      env[account] = await kc.get()
    } catch (err) {
      fail(err.message)
    }
  }

  const local = join(process.cwd(), 'node_modules', '.bin', 'dotenvx')
  const bin = existsSync(local) ? local : 'dotenvx'
  forward(bin, args, env, 'dotenvx not found (install @dotenvx/dotenvx in the project or globally)')
}

// --- keychain management CLI (commander) -----------------------------------

function buildCli() {
  const program = new Command()
  program
    .name('touchenv')
    .description('keychain-aware dotenvx — keep the dotenvx private key behind Touch ID')
    .version(pkgVersion(), '-V, --version')
    .addHelpText(
      'after',
      `
Passthrough:
  Any command other than 'keychain' is forwarded to dotenvx with
  DOTENV_PRIVATE_KEY injected from the macOS Keychain (Touch ID):

    touchenv run -- next build      run a command with the decrypted env
    touchenv decrypt                decrypt .env in place
    touchenv encrypt                encrypt .env in place
    touchenv set FOO bar            set + encrypt a variable

  Off macOS this is a plain dotenvx passthrough.`
    )

  const kc = program
    .command('keychain')
    .description('manage the dotenvx private key stored in the keychain')

  const withTarget = (cmd) =>
    cmd
      .option('-s, --service <name>', 'keychain service (default: <project>-dotenv)')
      .option('-a, --account <name>', 'item name (default: DOTENV_PRIVATE_KEY)')

  withTarget(kc.command('import'))
    .description('store the private key from .env.keys into the keychain (Touch ID)')
    .option('--from <file>', 'source dotenvx keys file', '.env.keys')
    .action(async (opts) => {
      const { service, account } = target(opts)
      if (!existsSync(opts.from)) fail(`${opts.from} not found (run from the project root)`)
      const line = readFileSync(opts.from, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(account + '='))
      if (!line) fail(`${account} not found in ${opts.from}`)
      const value = line.slice(account.length + 1).trim().replace(/^["']|["']$/g, '')
      if (!value) fail(`${account} is empty in ${opts.from}`)
      await run(() => new Keychain(service, { account }).set(value))
      ok(`stored '${account}' in keychain service '${service}'.\n` +
        `now opt in (DOTENV_USE_KEYCHAIN=true) and remove ${account} from ${opts.from}.`)
    })

  withTarget(kc.command('export'))
    .description('write the stored key back to a dotenvx keys file (Touch ID)')
    .option('--to <file>', 'destination keys file', '.env.keys')
    .action(async (opts) => {
      const { service, account } = target(opts)
      const value = await run(() => new Keychain(service, { account }).get())
      const entry = `${account}="${value}"`
      let lines = existsSync(opts.to) ? readFileSync(opts.to, 'utf8').split('\n') : []
      const idx = lines.findIndex((l) => l.startsWith(account + '='))
      if (idx >= 0) {
        lines[idx] = entry // replace just this key, preserve the rest
      } else {
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
        lines.push(entry)
      }
      writeFileSync(opts.to, lines.join('\n') + '\n')
      ok(`wrote '${account}' to ${opts.to} — plaintext on disk, delete it when you're done.`)
    })

  withTarget(kc.command('set'))
    .description('store the private key, read from stdin (Touch ID)')
    .action(async (opts) => {
      const { service, account } = target(opts)
      const value = await readStdin()
      if (!value) fail('no value on stdin')
      await run(() => new Keychain(service, { account }).set(value))
      ok(`stored '${account}' in keychain service '${service}'`)
    })

  withTarget(kc.command('get'))
    .description('print the stored key to stdout (Touch ID)')
    .action(async (opts) => {
      const { service, account } = target(opts)
      const value = await run(() => new Keychain(service, { account }).get())
      process.stdout.write(value)
    })

  withTarget(kc.command('rm'))
    .description('remove the stored key (e.g. to rotate it)')
    .action(async (opts) => {
      const { service, account } = target(opts)
      await run(() => new Keychain(service, { account }).delete())
      ok(`removed '${account}' from keychain service '${service}'`)
    })

  withTarget(kc.command('status'))
    .description('show the resolved config and whether the key is stored')
    .action(async (opts) => {
      const { service, account, gate } = target(opts)
      const lines = [
        `service:  ${service}`,
        `account:  ${account}`,
        `gate:     ${gate} (${isEnabled(gate) ? 'enabled' : 'disabled'})`,
      ]
      if (process.platform !== 'darwin') {
        lines.push('stored:   n/a (keychain is macOS-only)')
      } else {
        const present = await run(() => new Keychain(service, { account }).has())
        lines.push(`stored:   ${present ? 'yes' : 'no'}`)
      }
      process.stdout.write(lines.join('\n') + '\n')
    })

  return program
}

// --- helpers ---------------------------------------------------------------

function target(opts) {
  const cfg = resolveConfig()
  return {
    service: opts.service || cfg.service,
    account: opts.account || cfg.account,
    gate: cfg.gate,
  }
}

async function run(fn) {
  try {
    return await fn()
  } catch (err) {
    fail(err.message)
  }
}

function forward(bin, args, env, notFoundMsg) {
  const child = spawn(bin, args, { stdio: 'inherit', env })
  child.on('error', (err) => fail(err.code === 'ENOENT' ? notFoundMsg : err.message))
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data.trim()))
  })
}

function pkgVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

function ok(msg) {
  process.stderr.write(msg + '\n')
}

function fail(msg) {
  process.stderr.write(`touchenv: ${msg}\n`)
  process.exit(1)
}
