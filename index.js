import { spawn } from 'node:child_process'
import { ensureBinary } from './build.js'

/**
 * A Touch ID-gated handle on one macOS Keychain service.
 *
 *   const kc = new Keychain('my-app', { account: 'API_KEY' })
 *   await kc.set('secret')        // Touch ID prompt
 *   const v = await kc.get()      // Touch ID prompt
 *   await kc.has()                // existence check, no prompt
 *   await kc.delete()             // remove (Touch ID / device password)
 *
 * get/set/delete prompt for authentication; `has` does not (it never touches
 * the secret data). delete is destructive, so it allows the device-password
 * fallback in addition to Touch ID. `account` can be set once on the instance
 * and overridden per call.
 */
export class Keychain {
  /**
   * @param {string} service  Keychain service name (namespaces your items).
   * @param {object} [opts]
   * @param {string} [opts.account]  default item name; can be overridden per call.
   * @param {string} [opts.reason]   localized reason shown in the Touch ID prompt.
   * @param {string} [opts.identity='auto']  codesign identity: 'auto' | '-' | explicit.
   */
  constructor(service, { account, reason, identity = 'auto' } = {}) {
    if (!service) throw new Error('Keychain: `service` is required')
    this.service = service
    this.account = account
    this.reason = reason
    this.identity = identity
  }

  /** Read a secret. Prompts Touch ID. Rejects if absent (err.code === 5) or denied. */
  async get(account) {
    const out = await this.#run(['get', this.service, this.#item(account)])
    return out.replace(/\n$/, '')
  }

  /** Store/replace a secret. Prompts Touch ID. Value is passed via stdin. */
  async set(value, account) {
    await this.#run(['set', this.service, this.#item(account)], { input: String(value) })
  }

  /** Remove the item (Touch ID, or device password as fallback). Idempotent. */
  async delete(account) {
    await this.#run(['delete', this.service, this.#item(account)])
  }

  /** Whether the item exists. No prompt (doesn't read the secret). */
  async has(account) {
    try {
      await this.#run(['has', this.service, this.#item(account)])
      return true
    } catch (err) {
      if (err.code === 5) return false
      throw err
    }
  }

  #item(account) {
    const item = account ?? this.account
    if (!item) throw new Error('Keychain: `account` is required (pass it, or set it on the instance)')
    return item
  }

  #run(args, { input } = {}) {
    return ensureBinary({ identity: this.identity }).then(bin => new Promise((resolve, reject) => {
      const env = { ...process.env }
      if (this.reason) env.KEYCHAIN_TOUCHID_REASON = this.reason

      const child = spawn(bin, args, { env })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', d => { stdout += d })
      child.stderr.on('data', d => { stderr += d })
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) return resolve(stdout)
        const err = new Error(stderr.trim() || `keychain-touchid exited with code ${code}`)
        err.code = code
        reject(err)
      })

      child.stdin.end(input != null ? input : '')
    }))
  }
}

export default Keychain
