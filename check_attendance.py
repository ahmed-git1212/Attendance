from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).parent
errors = []

required = ["index.html", "form.html", "attendance.html", "session.html", "admin.html", "config.js", "Code.gs", "4.jpg"]
for name in required:
    if not (root / name).exists():
        errors.append(f"missing required file: {name}")

for name in ["index.html", "form.html", "attendance.html", "session.html", "admin.html"]:
    text = (root / name).read_text(encoding="utf-8")
    if "4.jpg" not in text:
        errors.append(f"{name}: branding image reference is missing")
    if "config.js" not in text and name in {"attendance.html", "session.html"}:
        errors.append(f"{name}: config.js is not included")

attendance = (root / "attendance.html").read_text(encoding="utf-8")
session = (root / "session.html").read_text(encoding="utf-8")
backend = (root / "Code.gs").read_text(encoding="utf-8")
config = (root / "config.js").read_text(encoding="utf-8")

for role in ["Teacher", "User", "Guest"]:
    if role not in attendance or role not in backend:
        errors.append(f"role mismatch or missing role: {role}")
for marker in ["action: 'signin'", "action: 'signout'", "getSession", "isApiConfigured"]:
    if marker not in attendance + session:
        errors.append(f"frontend integration marker missing: {marker}")
for marker in ["doGet", "doPost", "handleSignIn", "handleGetSession", "handleSignOut", "setupAttendanceSystem", "SHEET_SESSIONS", "SESSION_HEADERS"]:
    if marker not in backend:
        errors.append(f"backend marker missing: {marker}")
if "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE" not in config:
    errors.append("config.js placeholder is missing")

# Validate JavaScript syntax. Apps Script globals do not need to exist for syntax checking.
for name in ["Code.gs", "config.js"]:
    source = root / name
    syntax_file = source if source.suffix == ".js" else root / f".tmp_{name}.js"
    if syntax_file != source:
        syntax_file.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    result = subprocess.run(["node", "--check", str(syntax_file)], capture_output=True, text=True)
    if syntax_file != source:
        syntax_file.unlink(missing_ok=True)
    if result.returncode:
        errors.append(f"{name}: JavaScript syntax error: {result.stderr.strip()}")

for name in ["attendance.html", "session.html", "admin.html"]:
    text = (root / name).read_text(encoding="utf-8")
    scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", text, flags=re.S | re.I)
    for index, script in enumerate(scripts, start=1):
        temp = root / f".tmp_{name}_{index}.js"
        temp.write_text(script, encoding="utf-8")
        result = subprocess.run(["node", "--check", str(temp)], capture_output=True, text=True)
        temp.unlink(missing_ok=True)
        if result.returncode:
            errors.append(f"{name}: inline script {index} syntax error: {result.stderr.strip()}")

if errors:
    print("VALIDATION FAILED")
    print("\n".join(f"- {error}" for error in errors))
    sys.exit(1)

print("VALIDATION PASSED")
print("Checked required files, template branding, role consistency, integration markers, and JavaScript syntax.")
