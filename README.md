# ½M Stock Control

A private inventory dashboard for Half Million procurement. Every morning a
scheduled Claude job reads the stock workbook from SharePoint, and the dashboard
shows full inventory, critical stock and zero stock, behind a single login.

## How it fits together

```
SharePoint workbook ──(07:00 Riyadh, Claude + M365 connector)──► scripts/ingest.mjs
        │                                                         │ parse, classify, encrypt
        ▼                                                         ▼
  data/raw/latest.txt (never committed)          data/inventory.enc.json + history.enc.json
                                                                  │ git push
                                                                  ▼
                                                 GitHub Pages ─► browser decrypts after login
```

- **Static site, no server.** `index.html` + `assets/`. No build step, no npm packages.
- **Login = decryption.** Data is sealed with a public key (`data/keyring.json`). The
  matching private key is itself sealed with the user ID + password
  (PBKDF2-SHA256, 600k rounds → AES-GCM). Without the login, the hosted files are
  unreadable, and the daily job never needs the password.
- **Source today:** *Asset Inventory Management · Inventory 2 (procurement)*:
  equipment and furniture with opening quantity, stock in, stock out, on hand
  and units in use. Categories come from keywords in `config/source.json`.
- **Status rules** (`config/source.json → thresholds`):
  - *Out of stock*: on hand ≤ 0
  - *Critical*: on hand ≤ min level if the file has one; else < `criticalDays` of
    cover if it has daily usage; else (the current file) ≤ `criticalQty` units
    left, or on hand below `criticalCoverPct`% of units issued (stock out)
  - *Low*: within `lowFactor` × the unit limit, or below `lowCoverPct`% of units issued
  - *Healthy*: everything else
- **Layouts understood:** a list (one row per item or item × warehouse with a
  quantity column) or a matrix (items down the side, stores/warehouses across the
  top, as in the SOH trackers). Column names are matched against common aliases;
  add your own under `columns` in `config/source.json`.

## Day to day

| Task | Command |
|---|---|
| Preview locally | `npm run serve` then open http://localhost:8080 |
| Import a file by hand | `node scripts/ingest.mjs path/to/workbook.txt` |
| Check a file without writing | `node scripts/ingest.mjs path/to/workbook.txt --dry-run` |
| Change the login (keeps data) | `node scripts/credentials.mjs change --user OLD --password OLD --new-user NEW --new-password NEW` |
| Start over with a new key pair | `node scripts/credentials.mjs init --user ID --password PW` (then re-import) |
| Regenerate sample data | `node scripts/make-sample.mjs data/raw/sample.txt && node scripts/ingest.mjs data/raw/sample.txt --sample` |

The scheduled job follows [`docs/daily-import.md`](docs/daily-import.md).

## Hosting

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to
`main` or a `claude/**` branch. One-time setup: repository **Settings → Pages →
Source: GitHub Actions**. If the `github-pages` environment only allows the default
branch, add the publish branch under **Settings → Environments → github-pages**.
