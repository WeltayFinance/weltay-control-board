# WELTAY Control Board

A read-only control board for the WELTAY programme. It renders **Deliverables** and **RAAIDD** items (Risks, Assumptions, Actions, Issues, Dependencies, Decisions) from a single JSON file into a calm, scannable founder dashboard.

The board is a static site. It uses plain HTML, CSS, and JavaScript with no frameworks, no build step, and no server-side code. It reads `weltay_control_board_data.json` and never writes back to it or to GitHub.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure and element hooks |
| `style.css` | WELTAY brand styling and layout |
| `script.js` | All board logic (load, validate, render, filter, export) |
| `weltay_control_board_data.json` | The data the board displays (currently test data) |
| `README.md` | This file |

## Swapping test data for live data

The board is data-driven. To move from test data to the live project position, replace the contents of `weltay_control_board_data.json` with live data that uses the **same schema** (same top-level `meta`, `deliverables`, and `raaidd` structure and field names). No changes to `index.html`, `style.css`, or `script.js` are required.

Set `meta.datasetType` to anything other than `"test"` (for example `"live"`) and the Test Data Mode banner disappears automatically.

---

## Acceptance testing checklist

Work through these against the running board. Each item should pass before the board is considered ready.

### Loading and data integrity
- [ ] The board loads and displays without errors when `weltay_control_board_data.json` is present and valid.
- [ ] If the JSON is missing, malformed, or not an object with `deliverables` and `raaidd` arrays, a clear load error is shown instead of a blank or broken page.
- [ ] The Test Data Mode banner appears because `meta.datasetType` is `"test"`.
- [ ] Changing `meta.datasetType` to a non-test value hides the banner.
- [ ] The source / status strip shows source file, read-only mode, item counts, and any warning count.

### Default view and navigation
- [ ] The board opens on the **Deliverables** tab, not RAAIDD.
- [ ] Switching between Deliverables and RAAIDD tabs works and updates the visible filters (Workstream only on Deliverables, Type only on RAAIDD).
- [ ] Tab counts reflect the total number of records in each array.

### Founder Actions panel
- [ ] The panel aggregates every record where `founderActionRequired` is `true`, drawn from **both** Deliverables and RAAIDD.
- [ ] It does not list every Founder-owned item, only those explicitly flagged for action.
- [ ] Each action shows source, ID, priority, action type, description, due date, and linked IDs where present.
- [ ] With no flagged actions, the panel shows the calm empty state "No Founder Actions currently flagged."

### Milestone / readiness-gate cards
- [ ] Cards appear in the fixed readiness-gate order, regardless of whether gate values carry a "Gate" suffix.
- [ ] Each card shows total, not-started / live / blocked / complete counts, and percentage complete.
- [ ] Archived items are excluded from the headline percentage.
- [ ] P1 and P2 counts, and PM Review / Founder Review flags, are surfaced on the relevant cards.
- [ ] Items with no gate, or an explicit "None" gate, appear in a single "None / Unlinked" card placed last.

### Deliverables detail (Kanban and Table)
- [ ] Kanban is the default layout and groups deliverables by status in the fixed status order.
- [ ] A deliverable with an unrecognised status appears in an "Other / Unrecognised" column rather than disappearing.
- [ ] Blocked, PM Review, Founder Review, and P1 items are visually prominent without being alarmist.
- [ ] The Kanban / Table toggle switches layout and the choice persists.
- [ ] Table view shows the key columns and each row opens the detail drawer.

### RAAIDD dashboard and register
- [ ] The dashboard shows P1 / P2 / P3 counts per category for all six RAAIDD types.
- [ ] Each category shows a type-appropriate attention line (for example assumptions awaiting validation, decisions awaiting a call, dependencies blocked or waiting).
- [ ] The register below lists items, with decisions showing their outcome and assumptions showing their validation state.

### Detail drawer
- [ ] Clicking any card or table row opens the side drawer with the full record, including long fields not shown on the card.
- [ ] The drawer works for both Deliverables and RAAIDD records.
- [ ] Linked IDs inside the drawer are clickable and open the linked item in the drawer without losing context.
- [ ] The drawer closes via the close button, the overlay, or the Escape key.
- [ ] Founder action detail is shown clearly when the record is flagged.

### Search and filtering
- [ ] The search box matches across ID, title, description, owner, workstream, gate, notes, outcome, and linked IDs.
- [ ] Each filter (priority, status, owner, gate, workstream, type) narrows the current view correctly.
- [ ] Workstream filter applies only on Deliverables; type filter applies only on RAAIDD.
- [ ] Reset filters clears all filters and the search box.

### Historical items
- [ ] Done and Archived deliverables are hidden from the detail view by default and appear when "Show Done / Archived" is toggled on.
- [ ] Settled RAAIDD items are likewise quieter by default and appear when the equivalent toggle is on.

### Warnings panel
- [ ] The panel reports a count and lists specific issues for the deliberately malformed test records (duplicate ID, invalid priority, invalid status, missing required field, broken link, one-way link, missing gate, missing founder-action description).
- [ ] An explicit "None" gate is **not** reported as a warning; a blank gate **is**.
- [ ] Replacing the data with a clean dataset produces a clean state with no warnings.

### CSV export
- [ ] Export produces a CSV for the active view (Deliverables or RAAIDD).
- [ ] The export respects the current filters and search.
- [ ] The export includes the full field set, not only the visible columns, with array fields flattened to comma-separated values.
- [ ] Export never modifies the JSON.

### Robustness and persistence
- [ ] Missing optional fields render as "Not provided" or blank rather than breaking the board.
- [ ] Invalid or malformed records are surfaced in the warnings panel and still appear on the board rather than crashing it.
- [ ] Tab, filters, search text, layout, and the historical toggle are remembered across reloads.
- [ ] The board still works if browser storage is unavailable (preferences simply are not remembered).

### Deployment
- [ ] The board works when served over HTTP, including from GitHub Pages.
- [ ] After swapping the test JSON for live JSON of the same schema, the board works with no code changes.
- [ ] The board remains read-only throughout: it never writes to the JSON or to the repository.

> Note: opening `index.html` directly from disk via a `file://` path may block the JSON fetch in some browsers. Use GitHub Pages or any local static server (for example `python3 -m http.server`) to view it.

---

## GitHub Pages deployment note

1. Place all five files in the **root** of the repository (not inside a subfolder), keeping their names unchanged.
2. Commit and push to the `main` branch:
   ```
   git add index.html style.css script.js weltay_control_board_data.json README.md
   git commit -m "Add WELTAY Control Board"
   git push origin main
   ```
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose the `main` branch and the `/ (root)` folder, then save.
5. Wait a few minutes for the first deploy. The live URL is shown on the same Pages settings screen, typically `https://<user>.github.io/<repo>/`.
6. The board reads its data from `weltay_control_board_data.json` in the same folder. To update what the board shows, edit and commit that file only; the page refreshes its data on the next load. No other files need to change.

The board never writes data back. All updates happen by editing the JSON in the repository.
