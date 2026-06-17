#!/usr/bin/env node
import { Keychain } from './index.js'

function usage(code = 1) {
  process.stderr.write(`touchid-keychain — Touch ID-gated macOS Keychain access

usage:
  touchid-keychain get --service <service> <account>
  touchid-keychain set --service <service> <account>   # secret read from stdin

examples:
  touchid-keychain get -s my-app API_KEY
  printf '%s' "$SECRET" | touchid-keychain set -s my-app API_KEY
`)
  process.exit(code)
}

const argv = process.argv.slice(2)
const action = argv.shift()
if (action === '-h' || action === '--help') usage(0)
if (action !== 'get' && action !== 'set') usage()

let service
let account
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--service' || argv[i] === '-s') service = argv[++i]
  else account = argv[i]
}
if (!service || !account) usage()

try {
  const kc = new Keychain({ service })
  if (action === 'get') {
    process.stdout.write(await kc.get(account))
  } else {
    await kc.set(account, await readStdin())
    process.stderr.write(`stored '${account}' in keychain service '${service}'\n`)
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`)
  process.exit(1)
}

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => { data += c })
    process.stdin.on('end', () => resolve(data.trim()))
  })
}
