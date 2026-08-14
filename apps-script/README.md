# VennuSign Workbench Apps Script

This is the Sheet-bound Apps Script sidebar for the VennuSign Planning workbook.

It also provides a standalone web app. The spreadsheet remains the private storage layer and does not need to be open during normal use.

## Included

- Custom `VennuSign Workbench` menu
- Planning-tab and stable-record selection
- Approve, follow-up, review, and stop commands
- Append-only writes to `Codex Commands`
- Client idempotency keys and document locking
- Exact command-schema verification
- Formula-injection protection for user-controlled strings
- Relay health and recent activity display

The script does not contact Codex directly. The local relay will consume pending command rows in a later stage.

## Live Project

The project is bound to the VennuSign Planning workbook and deployed with `clasp`.

- Spreadsheet: `1DCtCrn5NAXCTNt5csmrjAOJvcCws7l9fdsnGQUCHFkM`
- Apps Script project: `1sqk8LNZVW497ARklAdSJhTNNBgezzsp1JPFAbMTE4yg47KQB2SXKA0qm`
- Web app: `https://script.google.com/macros/s/AKfycbxOdaLijlBocHAPmZjSdLZSCjh0VLj5bNP96ussSXPkLW2xjhgu_j5nDRDMBLIt_wNCBg/exec`

After changing local source, deploy from this directory:

```powershell
clasp push
```

Reload the spreadsheet and choose **VennuSign Workbench > Open sidebar**. The first use may request Google authorization for the bound script.

Do not enable the relay in `Codex Config` until the local relay has a verified thread ID and allowed workspace root.
