# Admin Event Log — setup

The Event Log (Admin Center → **Event Log**) works as soon as it's deployed.
It never adds or changes a column on any existing SharePoint list.

## What it shows

**From existing records (works right away, including past activity)**

- Every rotation, skip (override) and manual rotation, with who did it and when (RotationHistory).
- Every Start Day and End Day, with who did it and when (OperatingDays).
- When each admin account was created, and its most recent Admin Center sign-in (AdminUsers).
- The most recent maintenance-mode and kill-switch change (AppControl).

**Recorded from now on, in a new, separate list called `EventLog`**

- Admin Center sign-ins, failed sign-in attempts and sign-outs.
- Section changes: added, renamed, activated/deactivated, removed, and rotation order.
- Section mix, daily goals, and "apply goals to today".
- Store settings and notification settings.
- Locations added or activated/deactivated.
- User accounts: created, setup completed, level changed, activated/deactivated, deleted, password set, username changed, invite resent.
- Maintenance mode on, off, or time updated.
- **Rotation undone.** The undone rows are deleted, so this is the only record of it.

## The `EventLog` list

The app tries to create the list itself the first time something is recorded. If its SharePoint permission doesn't allow that, the Event Log page shows a notice. Until then, those admin actions aren't recorded, but everything else keeps working normally.

To create it by hand (about one minute):

1. Open the Outlet Rotation App SharePoint site → **New → List → Blank list**.
2. Name: `EventLog` (exactly, no space).
3. **Add column → Multiple lines of text**:
   - Name: `EventData` (exactly)
   - Plain text (not rich text)
4. That's all. The built-in **Title** and **Created** columns are used too.

Within a minute the app starts recording into it. No restart is needed.

## Notes

- Times are shown in Eastern time.
- One view covers up to 31 days, and a time range applies to every day in the date range.
- **If the list grows past about 5,000 rows:** in the EventLog list settings, add an **index** on the **Created** column so date filtering stays fast.
- Each row's `EventData` holds the event as JSON (type, location, who, details, time). Don't edit rows by hand.
- Recording never slows down or blocks an action. It runs after the page has responded, and any failure is ignored.
- The kill switch can be used without signing in, so only its most recent change is shown (from AppControl).
