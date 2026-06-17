// keychain-touchid — store/fetch a secret in the macOS login Keychain, gated by
// Touch ID.
//
//   keychain-touchid set <service> <account>   # secret read from stdin
//   keychain-touchid get <service> <account>   # secret written to stdout
//
// The Keychain item is created by THIS binary, so its default ACL trusts only
// this code identity: `security find-generic-password` (and any other app) gets
// a deny-able prompt instead of silent access, while this tool reads it after a
// successful Touch ID check.
//
// No entitlement is used — the data-protection keychain's OS-enforced biometric
// ACL needs a provisioning profile a bare CLI can't embed, so we use the legacy
// keychain + a trusted-app ACL instead. Works ad-hoc signed; a stable signing
// identity (e.g. an Apple Development cert) just avoids re-approving the keychain
// prompt after each rebuild.
import Foundation
import LocalAuthentication
import Security

let policy = LAPolicy.deviceOwnerAuthenticationWithBiometrics

func die(_ msg: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(("keychain-touchid: " + msg + "\n").data(using: .utf8)!)
    exit(code)
}

// "<system message> (code)", e.g. "The specified item could not be found… (-25300)".
func describe(_ status: OSStatus) -> String {
    let sys = SecCopyErrorMessageString(status, nil) as String? ?? "unknown error"
    return "\(sys) (\(status))"
}

func storeSecret(service: String, account: String, secret: String) -> Never {
    let match: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
    let delStatus = SecItemDelete(match as CFDictionary)

    var attrs = match
    attrs[kSecValueData as String] = Data(secret.utf8)
    // device-only: never syncs to iCloud Keychain, never leaves this Mac.
    attrs[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

    var status = SecItemAdd(attrs as CFDictionary, nil)
    if status == errSecDuplicateItem {
        status = SecItemUpdate(
            match as CFDictionary,
            [kSecValueData as String: Data(secret.utf8)] as CFDictionary)
    }

    switch status {
    case errSecSuccess:
        exit(0)
    case errSecDuplicateItem:
        die("""
            an item for '\(account)' already exists and is owned by another app, \
            so it can't be replaced. Delete it once, then retry:
              security delete-generic-password -s \(service) -a \(account)
            (delete status was \(describe(delStatus)))
            """, 2)
    case errSecAuthFailed, errSecUserCanceled:
        die("keychain authorization was denied — approve the prompt and retry. \(describe(status))", 4)
    default:
        die("could not store '\(account)': \(describe(status))", 2)
    }
}

func fetchSecret(service: String, account: String) -> Never {
    var item: CFTypeRef?
    let status = SecItemCopyMatching([
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ] as CFDictionary, &item)

    switch status {
    case errSecSuccess:
        guard let data = item as? Data, let secret = String(data: data, encoding: .utf8) else {
            die("stored value for '\(account)' is not valid UTF-8", 2)
        }
        FileHandle.standardOutput.write(Data(secret.utf8))
        exit(0)
    case errSecItemNotFound:
        die("no '\(account)' found in keychain service '\(service)' — store it first.", 5)
    case errSecAuthFailed, errSecUserCanceled:
        die("keychain access was denied — approve the prompt and retry. \(describe(status))", 4)
    default:
        die("could not read '\(account)': \(describe(status))", 2)
    }
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 3, args[0] == "get" || args[0] == "set" else {
    die("usage: keychain-touchid <get|set> <service> <account>  (set reads secret from stdin)")
}
let action = args[0]
let service = args[1]
let account = args[2]

let ctx = LAContext()
ctx.touchIDAuthenticationAllowableReuseDuration = 0 // prompt every time
ctx.localizedFallbackTitle = ""                     // no password fallback button
var policyError: NSError?
guard ctx.canEvaluatePolicy(policy, error: &policyError) else {
    die("biometrics unavailable: \(policyError?.localizedDescription ?? "unknown")", 3)
}

let env = ProcessInfo.processInfo.environment
let reason = env["KEYCHAIN_TOUCHID_REASON"]
    ?? (action == "get" ? "unlock a secret from the keychain" : "store a secret in the keychain")

ctx.evaluatePolicy(policy, localizedReason: reason) { ok, evalError in
    guard ok else { die("Touch ID failed: \(evalError?.localizedDescription ?? "denied")", 4) }
    if action == "get" {
        fetchSecret(service: service, account: account)
    } else {
        let stdin = FileHandle.standardInput.readDataToEndOfFile()
        let secret = (String(data: stdin, encoding: .utf8) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        storeSecret(service: service, account: account, secret: secret)
    }
}
dispatchMain()
