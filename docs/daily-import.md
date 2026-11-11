# Daily stock import (runbook for the 07:00 scheduled Claude job)

Goal: by 07:00 Riyadh time, the dashboard shows today's stock from the procurement
file. Work in the `shandrif/procurement-stocks` repository. Don't change app code
during the import; only `data/` and, if needed, `config/source.json`.

1. **Get the repo up to date.** Check out `publishBranch` from `config/source.json`
   and pull it.

2. **Find the file.** Use `config/source.json → source.connectorUri` if it is set.
   If not, search SharePoint with the Microsoft 365 connector (`sharepoint_search`)
   for `source.fileName` (fall back to the owner's name plus "stock"), pick the
   workbook whose `webUrl` is in Mohammad Hasan's OneDrive, and save its URI as
   `connectorUri` (and `fileName`) in `config/source.json`.

3. **Read it.** Call `read_resource` with that URI. If the reply says more sheets
   remain ("call again with startPage=N"), keep calling until every sheet is read.
   Save the text exactly as returned (all parts, in order) to
   `data/raw/latest.txt`. When the tool result was written to a file because it was
   large, copy that file instead of retyping it.

4. **Import.** Run `node scripts/ingest.mjs data/raw/latest.txt`.
   - Exit code 2 means no stock lines were recognised. Look at the sheet headers in
     `latest.txt` and add the real column names to `config/source.json → columns`
     (keys: item, code, category, location, qty, min, max, uom, unitCost, usage),
     or list summary sheets in `ignoreSheets`, then run it again. Use `--dry-run`
     while trying.
   - Check the printed summary looks sane (record count close to yesterday's).
     The current file has about 44 asset lines (Item Code, Item Description,
     Short Description, Opening Quantity, On Hand, Stock In, Stock Out, Used
     Working) and a totals row above the header; the "units" total should match
     that row's On Hand figure.
   - Only the tabs listed in `config/source.json → sheets` are imported (the
     procurement inventory tab). If that tab was renamed, every tab is read;
     update `sheets` to the new name.

5. **Publish.** Run `npm run deploy` (builds `_site/` and deploys the Cloudflare
   Worker `hm-stock-control` with the `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` from the environment). Then commit
   `data/inventory.enc.json`, `data/history.enc.json` and any config change with
   the message `Daily stock import <YYYY-MM-DD>` and push to `publishBranch`.
   Live site: https://hm-stock-control.abidihaiderabidi72.workers.dev

6. **If anything fails** (file not found, access denied, import error), don't push
   partial data. Yesterday's data stays live. Report what failed in one short
   message so the owner can fix access.

`data/raw/` is git-ignored: the plain-text workbook never leaves the job's machine.
Only encrypted files are committed.
