# License encryption configuration

## Required server-only environment variables

Configure these variables in the backend deployment's secret manager or protected environment.
They must never be provided to Vite, placed in a frontend `VITE_*` variable, stored in MongoDB,
committed to Git, printed to logs, or included in a backup.

| Variable | Value |
| --- | --- |
| `LICENSE_ENCRYPTION_KEY_V1` | A base64-encoded, cryptographically random 32-byte AES key |
| `LICENSE_ENCRYPTION_KEY_ID` | Optional non-secret identifier for that key; defaults to `v1` |

The backend crypto utility rejects missing, malformed, or incorrectly sized key material. Future
deployment wiring must validate this configuration during backend startup and fail closed when it
is absent.

## Generate the first key

Run this locally in PowerShell. Save only the printed value into the approved server-side secret
manager; do not paste it into source files, tickets, chat, or a shared document.

```powershell
$licenseKeyBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($licenseKeyBytes)
[Convert]::ToBase64String($licenseKeyBytes)
```

Assign the generated value to `LICENSE_ENCRYPTION_KEY_V1` and set
`LICENSE_ENCRYPTION_KEY_ID=v1`. The key must be present in every backend environment before any
license encryption, decryption, or migration code is enabled.

## Stored payload format

The backend utility produces this versioned shape for `passwordEncrypted`:

```json
{
  "version": 1,
  "algorithm": "aes-256-gcm",
  "keyId": "v1",
  "iv": "base64",
  "ciphertext": "base64",
  "authTag": "base64"
}
```

AES-256-GCM provides confidentiality and tamper detection. A new random 12-byte IV is generated
for every encryption, so the same password produces different ciphertext each time.

## Verification

Run the focused crypto tests from the repository root:

```powershell
node --test Backend/test/licensePasswordCrypto.test.js
```

The test key is generated in memory and is not a production key.

## Key rotation

Do not replace or delete `LICENSE_ENCRYPTION_KEY_V1` while any current database record or retained
backup uses `keyId: "v1"`; doing so makes those credentials unrecoverable. A future rotation must
first add multi-key decryption support, deploy the old and new keys together, re-encrypt every
record to the new key ID, verify the result, and only then retire the old key after its backup
retention period ends.
