import { spawn } from 'node:child_process'
import { ensureBinary } from './build.js'

/**
 * A Touch ID-gated handle on one macOS Keychain service.
 *
 *   const kc = new Keychain({ service: 'my-app' })
 *   await kc.set('API_KEY', 'secret')   // Touch ID prompt
 *   const key = await kc.get('API_KEY') // Touch ID prompt
 */
export class Keychain {
  /**
   * @param {object} opts
   * @param {string} opts.service   Keychain service name (namespaces your items).
   * @param {string} [opts.identity='auto']  codesign identity: 'auto' | '-' | explicit.
   * @param {string} [opts.reason]  localized reason shown in the Touch ID prompt.
   */
  constructor({ service, identity = 'auto', reason } = {}) {
    if (!service) throw new Error('Keychain: `service` is required')
    this.service = service
    this.identity = identity
    this.reason = reason
  }

  /** Read a secret. Prompts Touch ID. Rejects if the item is absent or denied. */
  async get(account) {
    const out = await this.#run(['get', this.service, account])
    return out.replace(/\n$/, '')
  }

  /** Store/replace a secret. Prompts Touch ID. Value is passed via stdin. */
  async set(account, value) {
    await this.#run(['set', this.service, account], { input: String(value) })
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
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr.trim() || `keychain-touchid exited with code ${code}`))
      })

      if (input != null) child.stdin.end(input)
      else child.stdin.end()
    }))
  }
}

export default Keychain
