# ZSSF Smart Attendance System

This folder contains the completed public attendance workflow using the supplied ZSSF branding template. The frontend is static HTML, CSS, and JavaScript intended for GitHub Pages. The backend is Google Apps Script backed by Google Sheets. Sign-in and sign-out each capture the user’s current location once; the browser does not perform continuous tracking.

## Files

| File | Purpose |
|---|---|
| `index.html` | Default GitHub Pages entry point; opens the attendance form. |
| `form.html` | Compatibility entry point for the original template; opens the attendance form. |
| `attendance.html` | Public sign-in form with name, phone, role, browser location capture, and backend submission. |
| `session.html` | Public sign-out flow that looks up an active session by phone, captures sign-out location, and confirms sign-out. |
| `admin.html` | Administrator entry page that opens the private Google Sheet for approved Google accounts. |
| `config.js` | The only frontend file that needs the deployed Apps Script Web App URL. |
| `Code.gs` | Google Apps Script backend for sign-in, active-session lookup, sign-out, location validation, IDs, and sheet setup. |
| `4.jpg` | Supplied ZSSF branding image used by the pages. |
| `check_attendance.py` | Local consistency and JavaScript syntax validator. |

## Setup

Create or open the Google Sheet that will store attendance data. The supplied sheet is already the target workbook. In its Apps Script editor, paste the contents of `Code.gs`, save the project, and run `setupAttendanceSystem()` once. Authorize the script when Google requests permission. The setup function creates the `Attendance`, `Admins`, `Settings`, `Counters`, and `Logs` sheets and adds the expected headers and default settings.

To enable distance validation, enter the organization’s latitude and longitude in the `Settings` sheet under `AttendanceLat` and `AttendanceLng`. Set `AllowedRadiusMeters` to the permitted radius. Use `FLEXIBLE` in `LocationPolicy` to record location states without rejecting out-of-range users, or `STRICT` to reject out-of-range sign-ins. The browser’s location permission is still required for location capture.

Deploy the Apps Script project as a Web App that executes as the owner and is accessible to the intended users. Copy the deployed URL ending in `/exec` into `config.js`, replacing `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`. Keep the URL only in `config.js`; both public pages read it from there.

Upload the static frontend files to the root of the GitHub Pages repository, including `admin.html`. The administrator opens `admin.html`, signs in through Google when prompted, and then uses the private spreadsheet’s `Sessions` tab to filter records and print them to PDF. Keep `4.jpg` in the same directory as the HTML pages. Opening the repository’s Pages URL will load `index.html`, which forwards to `attendance.html`.

## Validation

Run the following command from this folder before publishing:

```bash
python3 check_attendance.py
```

The validator checks required files, branding references, role consistency, frontend/backend integration markers, and JavaScript syntax. A live sign-in or sign-out test requires a deployed Apps Script URL and a configured Google Sheet; those credentials are intentionally not included in this folder.

## Important behavior

The backend generates the Attendance ID and timestamps, blocks duplicate active sign-ins for the same phone number, verifies sign-out ownership and active status, calculates duration, preserves completed records, and performs location validation on the server. The frontend shows a clear configuration message when the deployment URL has not yet been entered instead of reporting a misleading connection failure.
