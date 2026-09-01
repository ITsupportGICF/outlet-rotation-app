# Selection Mix change email — setup (Power Automate)

Same idea as the override email: when someone changes a section's commodity mix
in **Admin Center → Section Mix** and presses **Save … mix**, the app writes a
single row to a new **MixChangeLog** list — but **only when something actually
changed**. A Power Automate flow you own watches that list and sends the
notification. No new app permissions are needed.

## 1. One-time SharePoint change — create the `MixChangeLog` list

Create a new list called exactly **`MixChangeLog`** on the Outlet Rotation App
site, with these columns (the app writes these field names — spelling matters):

| Column | Type |
|---|---|
| `Title` | Single line of text (default column — leave it) |
| `OutletName` | Single line of text |
| `SectionName` | Single line of text |
| `ChangedByEmail` | Single line of text |
| `ChangedAt` | Date and Time (include time) |
| `PreviousMix` | Multiple lines of text (plain text) |
| `NewMix` | Multiple lines of text (plain text) |
| `Changes` | Multiple lines of text (plain text) |

Until this list exists the app still saves the mix normally — it just can't log
the change (the write is best-effort and is swallowed), so no email is sent.

## 2. Build the flow (Power Automate)

Create an **Automated cloud flow**:

1. **Trigger:** SharePoint → **When an item is created**.
   - Site Address: the Outlet Rotation App site.
   - List Name: **MixChangeLog**.
   - (No condition needed — the app only creates a row when the mix actually
     changed, so every new row is a real change.)
2. Add **Office 365 Outlook → Send an email (V2)**:
   - **To:** `SAdhikari@goodwillcfl.org` (change later as needed).
   - **Subject:** `Selection Mix changed — [SectionName] at [OutletName]`
     (use dynamic content **SectionName** and **OutletName**).
   - **Body:** switch the body box to **code view** (the `</>` button) and paste
     the contents of `docs/mix-change-email-template.html` (the part inside
     `<body>…</body>` is enough), then replace the `[[TOKENS]]`:

     | Token | Replace with |
     |---|---|
     | `[[STORE]]` | dynamic content **OutletName** |
     | `[[SECTION]]` | dynamic content **SectionName** |
     | `[[BY]]` | dynamic content **ChangedByEmail** |
     | `[[CHANGES]]` | dynamic content **Changes** |
     | `[[PREVIOUS]]` | dynamic content **PreviousMix** |
     | `[[NEW]]` | dynamic content **NewMix** |
     | `[[DATE]]` | expression (below) |
     | `[[TIME]]` | expression (below) |

   **Date expression** (Eastern time, DST-aware):
   ```
   convertFromUtc(triggerOutputs()?['body/ChangedAt'], 'Eastern Standard Time', 'MMMM d, yyyy')
   ```
   **Time expression:**
   ```
   convertFromUtc(triggerOutputs()?['body/ChangedAt'], 'Eastern Standard Time', 'h:mm tt')
   ```
   (`Eastern Standard Time` is the Windows zone id; `convertFromUtc` applies
   daylight saving automatically, so it reads correctly year-round.)

3. **Save** and test: open **Section Mix**, change one commodity's quantity for a
   section, press **Save … mix**. You should get one email. Save again without
   changing anything → **no** email (nothing changed → no row written).

## What the email contains

- **Store**, **Section**, **Changed by** (the M365 user who saved), **Date/Time**
  of the change.
- **What changed** — only the commodities that changed, e.g.
  `Shirts: 5 → 8, Shoes: 0 → 2`.
- **Previous mix** and **New mix** — the full per-commodity mix on each side,
  e.g. `Shirts: 5, Pants: 3, Shoes: 0`.

## Notes
- The email fires **only** on a real change + a Save press. Opening the tab,
  or saving with no edits, writes nothing and sends nothing.
- One Save of one section = one MixChangeLog row = one email. Each section has
  its own Save button, so changing two sections sends two emails.
- To change recipients later, just edit the **To** field on the flow — no app
  change needed.
