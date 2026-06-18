# touchenv

Keychain-aware [dotenvx](https://dotenvx.com) for macOS: keep the dotenvx private key in the **macOS Keychain behind Touch ID** instead of a plaintext `.env.keys` on disk. dotenvx encrypts your `.env`; touchenv is the missing piece — **where the private key lives**. **No Apple Developer cert required**, and it's a plain dotenvx passthrough off macOS so it never breaks CI/Linux builds.

```bash
touchenv run --convention=nextjs -- next dev   # Touch ID, then dotenvx run …
touchenv decrypt                               # any dotenvx command works
```

## Install

```bash
npm install touchenv        # or: bun add touchenv
npm install -g touchenv     # global, use `touchenv` anywhere
```

Installs on **any platform** — the Swift helper compiles lazily on first use, so nothing native runs at install time. The keychain features need **macOS** with Touch ID and the **Xcode Command Line Tools** (`xcode-select --install`). You also need `dotenvx` available (project-local or global) for the passthrough.

## How it works

`touchenv <args…>` forwards everything to the real `dotenvx`. Before doing so, *when opted in*, it fetches `DOTENV_PRIVATE_KEY` from the Keychain behind a Touch ID prompt and injects it, so dotenvx decrypts with it.

- **Opt-in** via a gate env var (default `DOTENV_USE_KEYCHAIN`), checked in the environment then `.env.local` / `.env`. Not truthy → no prompt, plain passthrough.
- **Non-macOS** → keychain skipped entirely. Safe on Vercel/Linux/CI, where dotenvx uses its normal key resolution (a `DOTENV_PRIVATE_KEY` env var).
- **Zero config by convention** — `service` = `"<package-name>-dotenv"`, `account` = `DOTENV_PRIVATE_KEY`, `gate` = `DOTENV_USE_KEYCHAIN`. Override per project in `package.json`:

```jsonc
"touchenv": { "service": "my-svc", "account": "DOTENV_PRIVATE_KEY", "gate": "USE_KEYCHAIN" }
```

Typical `package.json` scripts:

```jsonc
"scripts": {
  "dev": "touchenv run --convention=nextjs -- next dev",
  "build": "touchenv run -- next build"
}
```

## Managing the key

The `keychain` group manages the stored key. Service/account come from the convention, so usually no flags are needed.

```bash
touchenv keychain import     # one-time: pull DOTENV_PRIVATE_KEY from .env.keys into the keychain (Touch ID)
                             # then set DOTENV_USE_KEYCHAIN=true and delete .env.keys
touchenv keychain status     # show service/account/gate and whether the key is stored (no prompt)
touchenv keychain export     # write the key back to .env.keys (Touch ID) — for recovery/migration
touchenv keychain rm         # remove the stored key (e.g. to rotate)
touchenv keychain get        # print the key (Touch ID)
touchenv keychain set        # store the key from stdin (Touch ID)
```

Flags on any of them: `-s, --service <name>`, `-a, --account <name>`; `import`/`export` also take `--from`/`--to <file>` (default `.env.keys`).

## JS API

```js
import { Keychain } from 'touchenv'

const kc = new Keychain('my-app-dotenv', { account: 'API_KEY' })
await kc.set('secret')   // Touch ID
const v = await kc.get() // Touch ID
await kc.has()           // existence check — no prompt
await kc.delete()        // remove — no prompt
```

`account` can be set once on the instance and overridden per call (`kc.get('OTHER')`). Reads and writes prompt Touch ID; `has` and `delete` don't (they never touch the secret data). A missing item makes `get` reject with `err.code === 5`.

## Security model (honest)

macOS's built-in `security` CLI can't gate items on Touch ID — biometric items need the data-protection keychain (provisioning-profile'd app bundle). So this uses the **legacy keychain + the trusted-application ACL**: the helper creates the item, so only its code identity is trusted; `security find-generic-password` gets a deny-able prompt instead of silent access, and the helper runs a `LocalAuthentication` check before reading. Items are stored `WhenUnlockedThisDeviceOnly` (never synced to iCloud).

This is *user-presence* protection, not an unbypassable vault: a process running as you can still invoke the helper and trigger a prompt you'd have to approve — but it can't read the secret silently, and the key never sits in a plaintext dotfile. For OS-enforced biometric access use the data-protection keychain (paid Developer Program) or a notarized vault like 1Password's `op`.

### Signing

The helper is code-signed so the keychain can trust it. With an `Apple Development` cert (auto-detected) the identity is stable, so you approve "Always Allow" once. Ad-hoc signing also works — you just re-approve after recompiling the helper. The build cache keys on source + identity, so the same binary is reused across rebuilds and projects.

## License

MIT
