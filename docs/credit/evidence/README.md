# Credit evidence

The checked-in JSON is synthetic fixture evidence, **not a live business attestation**. It was produced without a private key or network connection:

```sh
ATTESTATION_NONCE=42 npx -y pnpm@10.32.0 --filter @bondrail/attester start --fixture test/fixtures/mixed.json
```

Its filename is keccak256 of the exact UTF-8 file contents. Do not pretty-print or append a newline before verifying the hash. Live dry-runs write additional content-addressed files here; keep evidence available to readers who receive the corresponding attestation. The registry stores the hash, not the JSON.
