# touchenv

Store the [dotenvx](https://dotenvx.com) private key in the macOS Keychain, gated by Touch ID, instead of a plaintext `.env.keys` in your project.

dotenvx encrypts your `.env` but keeps the decryption key in `.env.keys` on disk. touchenv moves that key into the Keychain and wraps dotenvx, so commands run the same but the key is fetched behind a Touch ID prompt rather than read from a file. Off macOS it forwards to dotenvx untouched, so CI and Linux builds are unaffected.

```bash
touchenv run -- next build      # Touch ID, then: dotenvx run -- next build
touchenv decrypt                # every dotenvx command works the same
```

No Apple Developer certificate is required.

## Install

```bash
npm install touchenv        # or bun add / pnpm add
npm install -g touchenv     # to use `touchenv` anywhere
```

The package installs on any platform; the Swift helper is compiled on first use, not at install time. Keychain features require macOS with Touch ID and the Xcode Command Line Tools (`xcode-select --install`). The passthrough requires `dotenvx` on `PATH` or in the project.

## Quick start

If the project already uses dotenvx (an encrypted `.env` and a `.env.keys`):

```bash
touchenv keychain store                   # .env.keys -> Keychain (Touch ID)
echo "DOTENV_USE_KEYCHAIN=true" >> .env.local
rm .env.keys                              # the key now lives only in the Keychain
touchenv run -- node server.js            # key is pulled from the Keychain
```

If you haven't encrypted yet, run `touchenv encrypt` first, then store.

Verify the resolved configuration without a prompt:

```bash
touchenv keychain status
# service:  myapp-dotenv
# account:  DOTENV_PRIVATE_KEY
# gate:     DOTENV_USE_KEYCHAIN (enabled)
# stored:   yes
```

## Usage

Call `touchenv` wherever you'd call `dotenvx`:

```jsonc
"scripts": {
  "dev":   "touchenv run --convention=nextjs -- next dev",
  "build": "touchenv run -- next build",
  "start": "touchenv run -- node dist/server.js"
}
```

The first command in a session prompts Touch ID. With a stable signing identity you can approve "Always Allow" once. Any dotenvx subcommand is forwarded:

```bash
touchenv set STRIPE_KEY sk_live_123
touchenv get STRIPE_KEY
touchenv ls
```

## Managing the key

The `keychain` group operates on the stored key. Service and account default by convention, so flags are rarely needed.

```bash
touchenv keychain store         # .env.keys -> Keychain (Touch ID)
touchenv keychain export        # Keychain -> .env.keys (Touch ID), for recovery or migration
touchenv keychain status        # configuration and whether the keys are stored (no prompt)
touchenv keychain rm            # remove the stored keys (Touch ID / device password) — destructive
```

Each accepts `-s, --service <name>` and `-a, --account <name>`. `store` takes `--from <file>` and `export` takes `--to <file>` (default `.env.keys`); `export` refuses to overwrite an existing file unless you pass `--force`. Raw single-value reads and writes live in the JavaScript API below.

### Rotating keys

`dotenvx rotate` generates a fresh keypair, re-encrypts `.env`, and writes the new private key to `.env.keys`. With the key in the Keychain there is no `.env.keys` on disk, so bring it down, rotate, push the new key back, and remove the plaintext:

```bash
touchenv keychain export                  # Keychain -> .env.keys (Touch ID)
touchenv rotate                           # re-encrypt .env, write the new key to .env.keys
touchenv keychain store --from .env.keys  # new key -> Keychain (Touch ID), replaces the old
rm .env.keys                              # the new key now lives only in the Keychain
```

Commit the re-encrypted `.env`. To rotate a single env file, pass it through: `touchenv rotate -f .env.production`.

## Behavior

`touchenv <args>` forwards to `dotenvx`. Before forwarding, when the gate is set, it reads `DOTENV_PRIVATE_KEY` from the Keychain behind a Touch ID prompt and injects it into the environment.

- Gating: the gate variable (default `DOTENV_USE_KEYCHAIN`) is read from the environment, then `.env.local`, then `.env`. If it is not truthy, touchenv is a plain passthrough with no prompt.
- Off macOS: the Keychain is skipped. dotenvx uses its normal resolution, which is a `DOTENV_PRIVATE_KEY` environment variable.
- Convention: `service` is `<package-name>-dotenv`, `account` is `DOTENV_PRIVATE_KEY`, `gate` is `DOTENV_USE_KEYCHAIN`. Override in `package.json`:

```jsonc
"touchenv": { "service": "my-svc", "account": "DOTENV_PRIVATE_KEY", "gate": "USE_KEYCHAIN" }
```

## CI and hosted builds

No script changes are needed. Off macOS the Keychain path is skipped, so provide the key the standard dotenvx way by setting `DOTENV_PRIVATE_KEY` as a platform environment variable. The gate lives in `.env.local` (uncommitted), so CI never enables the Touch ID path and stays a passthrough.

## JavaScript API

```js
import { Keychain } from 'touchenv'

const kc = new Keychain('my-app-dotenv', { account: 'API_KEY' })

await kc.set('s3cret')     // Touch ID
const v = await kc.get()   // Touch ID
await kc.has()             // existence check, no prompt
await kc.delete()          // remove, no prompt
```

`account` is set on the instance and can be overridden per call (`kc.get('OTHER')`). `get`/`set`/`delete` prompt for authentication; `has` does not. `delete` is destructive, so it accepts the device-password fallback in addition to Touch ID. A missing item rejects `get` with `err.code === 5`.

## Security model

macOS does not let the built-in `security` CLI gate items on Touch ID; biometric items require the data-protection keychain, which needs a provisioning profile a bare CLI cannot embed. touchenv instead uses the legacy keychain with a trusted-application ACL. The signed helper creates the item, so only its code identity is trusted: other tools, including `security find-generic-password`, get a deny-able prompt rather than silent access, and the helper runs a `LocalAuthentication` check before reading. Items are stored `WhenUnlockedThisDeviceOnly` and never sync to iCloud.

This is user-presence protection, not an unbypassable vault. A process running as your user can invoke the helper and trigger a prompt you would have to approve, but it cannot read the secret silently, and the key is never written to a plaintext dotfile. For OS-enforced biometric access, use the data-protection keychain with a paid Developer Program account, or a vault such as 1Password's `op`.

The helper is code-signed so the Keychain can trust it. An auto-detected `Apple Development` certificate gives a stable identity, so "Always Allow" is approved once; ad-hoc signing also works but requires re-approval after the helper is recompiled. The build cache keys on source and identity, so one binary is reused across rebuilds and projects.

## License

MIT
