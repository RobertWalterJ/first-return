# Wraps src/first-return.html (which is also the Artifact page) into docs/index.html for the local app.
from pathlib import Path
root = Path(__file__).parent
body = (root / "src" / "first-return.html").read_text(encoding="utf-8")
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#040506">\n<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" href="icon.svg">\n</head>\n<body>\n')
(root / "docs" / "index.html").write_text(head + body + "\n</body>\n</html>\n", encoding="utf-8")
print("built docs/index.html")
