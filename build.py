# Builds docs/index.html from src/shell.html (markup and CSS) and src/js/*.js (joined in name order
# inside one function scope). Edit the sources, never the built file.
from pathlib import Path
root = Path(__file__).parent
shell = (root / "src" / "shell.html").read_text(encoding="utf-8")
js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((root / "src" / "js").glob("*.js")))
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">\n'
        '<meta name="theme-color" content="#0b0d0f">\n<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" href="icon.svg">\n</head>\n<body>\n')
page = head + shell + "\n<script>\n(() => {\n'use strict';\n" + js + "\n})();\n</script>\n</body>\n</html>\n"
(root / "docs" / "index.html").write_text(page, encoding="utf-8")
print("built docs/index.html", len(page)//1024, "KB")
