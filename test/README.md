# Verification

Browser-driven checks for the defects found in the September 2026 audits. Each assertion
reproduces a specific reported failure, so a regression here names the thing that broke.

Needs a running server and playwright:

```sh
node server.mjs
```

```sh
npm --prefix /tmp i playwright@1.48.0
```

```sh
cd /tmp && node /path/to/test/verify-fixes.mjs
```

```sh
cd /tmp && node /path/to/test/verify-feed.mjs
```

`verify-fixes.mjs` covers the store, the API and the studio (26 assertions).
`verify-feed.mjs` covers the embedded feed (12 assertions).
Both expect an empty store — delete `content/store.json` between runs.
