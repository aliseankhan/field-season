"""Local static server for the game, like `python3 -m http.server`, but it tells
the browser not to cache, so an edited module is picked up on a normal reload.

    python3 tools/serve.py [port]      (serves this game folder on 127.0.0.1)

The game pings api/ping beside its page for the island board; here that answers "no
board" (rather than a 404 in the browser's console), so the board stays hidden. For the
board itself, run tools/scoreboard_server.py with --static.
"""
import functools
import http.server
import os
import sys

NO_BOARD = b'{"ok":false,"board":false}'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _no_board(self, head=False):
        if not self.path.split("?", 1)[0].endswith("/api/ping"):
            return False
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(NO_BOARD)))
        self.end_headers()
        if not head:
            self.wfile.write(NO_BOARD)
        return True

    def do_GET(self):
        if not self._no_board():
            super().do_GET()

    def do_HEAD(self):
        if not self._no_board(head=True):
            super().do_HEAD()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8772
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {root} on http://127.0.0.1:{port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
