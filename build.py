# Builds docs/index.html from src/shell.html (markup and CSS) and src/js/*.js (joined in name order
# inside one function scope). Edit the sources, never the built file.
from pathlib import Path
root = Path(__file__).parent
shell = (root / "src" / "shell.html").read_text(encoding="utf-8")
js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((root / "src" / "js").glob("*.js")))
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">\n'
        '<meta name="theme-color" content="#0b0d0f">\n<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" href="icon.svg">\n'
        # coi-serviceworker (MIT) adds the cross-origin isolation headers GitHub Pages cannot send, so the
        # models can use several CPU cores. It reloads the page once on the first visit.
        '<script>window.coi={coepCredentialless:()=>true,quiet:true};</script>\n<script src="coi-serviceworker.js"></script>\n'
        '</head>\n<body>\n')
# Lighter page: drop full-line comments and indentation from the script. Only whole comment lines go,
# so nothing inside strings (URLs, shader code) is touched.
js_min = "\n".join(l.strip() for l in js.split("\n") if l.strip() and not l.strip().startswith("//"))
page = head + shell + "\n<script>\n(() => {\n'use strict';\n" + js_min + "\n})();\n</script>\n</body>\n</html>\n"
(root / "docs" / "index.html").write_text(page, encoding="utf-8")
print("built docs/index.html", len(page)//1024, "KB")
# Refuse to leave a page that cannot even parse: check the joined script with Node when it is installed.
import subprocess, shutil, sys
if shutil.which("node"):
    check = subprocess.run(["node", "-e", "try{new Function(require('fs').readFileSync(0,'utf8'))}catch(e){console.error(e.message);process.exit(1)}"],
                           input="(() => {\n'use strict';\n" + js_min + "\n})();", capture_output=True, text=True, encoding="utf-8")
    if check.returncode:
        print("SYNTAX ERROR:", check.stderr.strip()); sys.exit(1)
    print("syntax ok")
