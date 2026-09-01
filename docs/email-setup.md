# Email notifications — setup (app sends directly, no Power Automate)

The app sends all notification emails **itself** through Microsoft Graph, using
the organization's Entra app registration. There are **no Power Automate flows**
and nothing tied to any one person's account — so it keeps working after anyone
leaves. Recipients and the sending mailbox are managed in **Admin Center →
Notifications** by any admin.

Emails sent this way:
- **End of Day** — full day summary when End Day is pressed.
- **Config changes** — section mix changed; section added / removed / activated /
  deactivated.
- **Override** — a section was skipped.

This **replaces** the earlier Power Automate approach (ConfigChangeLog /
EndOfDayLog / MixChangeLog lists and flows are no longer used — you can ignore
those docs).

---

## One-time setup (about 15 minutes, needs a Global/Exchange admin)

### 1. Grant the app permission to send mail
In **Entra admin center → App registrations →** your Outlet Rotation app **→ API
permissions**:
1. **Add a permission → Microsoft Graph → Application permissions →** search
   **`Mail.Send`** → add it.
2. Click **Grant admin consent** (same step you did for `Sites.Selected`).

### 2. Pick a "send from" mailbox (org-owned, not personal)
Use a mailbox the organization owns so it survives staff changes — a **shared
mailbox** is ideal (free in M365, e.g. `outlet-rotation@goodwillcfl.org`), or any
existing licensed mailbox. Create the shared mailbox in the Exchange admin center
if you don't have one. **Avoid a personal mailbox** (it disappears when that
person leaves).

### 3. Lock the app to just that mailbox (important, ~2 minutes)
By default `Mail.Send` (application) would let the app send as *any* mailbox.
Restrict it to only the send-from mailbox with an **Application Access Policy**.
In Exchange Online PowerShell (`Connect-ExchangeOnline`):

```powershell
# <AppId> = the app registration's Application (client) ID
# <mailbox> = the send-from address, e.g. outlet-rotation@goodwillcfl.org
New-ApplicationAccessPolicy -AppId <AppId> `
  -PolicyScopeGroupId <mailbox> -AccessRight RestrictAccess `
  -Description "Outlet Rotation App may send only as this mailbox"

# verify:
Test-ApplicationAccessPolicy -Identity <mailbox> -AppId <AppId>   # AccessCheckResult: Granted
```

(If the scope must be a group, put the mailbox in a mail-enabled security group
and use that group's address as `-PolicyScopeGroupId`.)

### 4. Create the settings list
Create a SharePoint list named exactly **`NotificationSettings`** on the Outlet
Rotation App site with:

| Column | Type |
|---|---|
| `Title` | Single line of text (default — leave it) |
| `FromMailbox` | Single line of text |
| `Recipients` | Single line of text |
| `EnableEndOfDay` | Yes/No |
| `EnableConfigChange` | Yes/No |
| `EnableOverride` | Yes/No |

(Until this list exists the app runs fine — it just won't send until you save
settings below.)

### 5. Turn it on in the app
**Admin Center → Notifications**:
- **Send from:** the mailbox from step 2.
- **Recipients:** `SAdhikari@goodwillcfl.org; zthorpe@goodwillcfl.org` (comma or
  semicolon separated — add/remove anytime).
- Tick the notification types you want.
- **Save**, then test: press **End Day** on an outlet with an open day, and do a
  section mix change and an override — the recipients should get an email for
  each.

---

## Also still needed (unrelated to how mail is sent)
- On the **RotationHistory** list, the `RotationType` choice column must include
  **`Override`** (the app writes that value when a section is skipped — it's also
  what advances the cycle). Add it under the column's Choices if not present.

## Keeping it self-sustaining (no dependency on the original developer)
- **Own the app registration as a group.** In Entra → the app → **Owners**, add
  an IT admin group (not just one person), so it's never orphaned.
- **Send-from is a shared/org mailbox** (step 2), not anyone's personal mailbox.
- **Client secret rotation.** The app already uses an Entra **client secret**
  (for all SharePoint access, not just email); secrets expire. Set a calendar
  reminder before its expiry to create a new secret in the app registration and
  update `ENTRA_CLIENT_SECRET` in the app's config. For the longest life,
  consider switching to a **certificate** credential (doesn't expire as often).
- **Recipients are in the app**, so changing who gets emails never requires a
  developer or a backend change — any Admin Center user can do it.

## How it behaves
- All sending is **best-effort**: if the mailbox/permission isn't set up, a type
  is turned off, or recipients are blank, the app simply doesn't send — the
  underlying action (End Day, save, override) always still succeeds.
- Recipients are validated (must contain `@`); blank/invalid entries are ignored.
- The "from" mailbox is only ever the one you set here (and, with step 3, the
  only one the app is technically allowed to use).
