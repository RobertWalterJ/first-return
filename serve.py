# Local server for First Return. Cross-origin isolation headers let the depth model use several CPU threads.
import http.server, socket, sys, os, webbrowser, threading
PORT = 8811
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs"))
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"}
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def log_message(self, *a): pass
def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception: return None
srv = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), H)
print(f"First Return is running.\n  On this computer: http://localhost:{PORT}")
ip = lan_ip()
if ip: print(f"  On your phone (same Wi-Fi): http://{ip}:{PORT}")
print("Close this window to stop it.")
if "--no-browser" not in sys.argv: threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
srv.serve_forever()
