# Override Email — setup (Power Automate)

When someone overrides/skips a section on the Input Screen, the app writes a
single **RotationHistory** row with **RotationType = `Override`** (Quantity 0,
no commodity). A Power Automate flow you own watches for those rows and sends
the notification email. No new app permissions are needed — the app just
records the row.

## 1. One-time SharePoint change — add the `Override` choice

The app writes `RotationType = "Override"`, so that value must exist on the
column:

1. Open the **RotationHistory** list → **Settings** (gear) → **List settings**
   → columns → **RotationType**.
2. Under **Choices**, add a line: `Override` (so the choices are
   `Standard`, `Manual`, `Override`).
3. Save.

(Until this is added, an override press will error instead of recording.)

## 2. Build the flow (Power Automate)

Create an **Automated cloud flow**:

1. **Trigger:** SharePoint → **When an item is created**.
   - Site Address: the Outlet Rotation App site.
   - List Name: **RotationHistory**.
2. **Condition:** `RotationType Value` **is equal to** `Override`.
   - (In the dynamic content picker choose *RotationType Value*, not the whole
     RotationType object.)
3. In the **If yes** branch, add **Office 365 Outlet → Send an email (V2)**:
   - **To:** `SAdhikari@goodwillcfl.org` (change later as needed).
   - **Subject:** `Rotation Section Overridden — [Section] at [Store]`
     (use dynamic content for Section Value and Outlet Value).
   - **Body:** switch the body box to **code view** (the `</>` button) and
     paste the contents of `docs/override-email-template.html` (the part inside
     `<body>…</body>` is enough), then replace the four `[[TOKENS]]`:

     | Token | Replace with |
     |---|---|
     | `[[STORE]]` | dynamic content **Outlet Value** |
     | `[[SECTION]]` | dynamic content **Section Value** |
     | `[[DATE]]` | expression (below) |
     | `[[TIME]]` | expression (below) |

   **Date expression** (Eastern time, DST-aware):
   ```
   convertFromUtc(triggerOutputs()?['body/RotatedAt'], 'Eastern Standard Time', 'MMMM d, yyyy')
   ```
   **Time expression:**
   ```
   convertFromUtc(triggerOutputs()?['body/RotatedAt'], 'Eastern Standard Time', 'h:mm tt')
   ```
   (`Eastern Standard Time` is the Windows zone id; `convertFromUtc` applies
   daylight saving automatically, so it reads correctly year-round.)

4. **Save** and test with a real override from the Input Screen.

## Notes
- One override = one RotationHistory row = one email (rotations write several
  rows but never with RotationType Override, so they won't trigger this).
- To change or add recipients later, just edit the **To** field on the flow —
  no app change needed.
- If you'd rather the app send the email itself later (instead of Power
  Automate), that's the `Mail.Send` route we discussed — more setup and a
  broader permission; the Power Automate approach keeps the app's footprint
  minimal.
