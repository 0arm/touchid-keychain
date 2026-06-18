import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir, arch } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'src', 'keychain-touchid.swift')

/**
 * Compile + sign the helper once, cached under
 * ~/.cache/touchid-keychain/<srcHash+identity>-<arch>/. Because the cache key
 * includes the source hash and signing identity, the same binary file (and thus
 * the same code identity the Keychain ACL trusts) is reused across rebuilds and
 * across every project on the machine — so "Always Allow" sticks, even ad-hoc.
 *
 * @param {{ identity?: string }} [opts] identity: 'auto' (default) picks an
 *   Apple Development cert if present, else ad-hoc ('-'); or pass an explicit
 *   codesign identity string, or '-' to force ad-hoc.
 * @returns {Promise<string>} absolute path to the compiled, signed binary.
 */
export async function ensureBinary({ identity = 'auto' } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('touchid-keychain only works on macOS (Touch ID + Keychain).')
  }

  const signingIdentity = resolveIdentity(identity)
  const src = readFileSync(SRC)
  const hash = createHash('sha256').update(src).update(signingIdentity).digest('hex').slice(0, 16)
  const dir = join(homedir(), '.cache', 'touchid-keychain', `${hash}-${arch()}`)
  const bin = join(dir, 'keychain-touchid')
  if (existsSync(bin)) return bin

  mkdirSync(dir, { recursive: true })

  try {
    execFileSync('swiftc', [
      SRC, '-o', bin,
      '-framework', 'LocalAuthentication',
      '-framework', 'Security',
      '-framework', 'Foundation',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    const detail = err.stderr?.toString().trim() || err.message
    throw new Error(
      `failed to compile the Touch ID helper. Are the Xcode Command Line Tools ` +
      `installed? Run \`xcode-select --install\`.\n${detail}`)
  }

  execFileSync('codesign', ['-f', '-s', signingIdentity, bin], { stdio: ['ignore', 'ignore', 'pipe'] })
  return bin
}

function resolveIdentity(identity) {
  if (identity && identity !== 'auto') return identity // explicit string, or '-'
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    })
    const match = out.match(/"(Apple Development:[^"]+)"/)
    if (match) return match[1]
  } catch {
    // fall through to ad-hoc
  }
  return '-' // ad-hoc: works fine, just re-prompts "Always Allow" after a rebuild
}
