"""DWG → DXF: POST /convert with the drawing as the body; answers the DXF, or 422 with why. GET /health answers ok.

Each drawing is read by LibreDWG's dwg2dxf in a folder of its own, removed after. Nothing else is kept.
"""
import os
import re
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

MAX_BYTES = 300 * 1024 * 1024
TIMEOUT = 110


LINE = re.compile(rb"\r\n|\n|\r")


def mended(dxf):
    """A DXF goes two lines at a time: a group code (a whole number), then its value. dwg2dxf writes some multi-line
    texts with their line breaks inside the value, which shifts every pair after it, and a viewer then reads text as a
    code ("Cannot parse group code: BATT ON BATHROOM..."). A line found where a code should be is put back on the value
    before it, the break kept as the text's own paragraph mark (\\P), so the file keeps its rhythm."""
    lines = LINE.split(dxf)
    while lines and not lines[-1].strip():
        lines.pop()
    out = []
    expecting_code = True
    for line in lines:
        if expecting_code:
            stripped = line.strip()
            if stripped.lstrip(b"-").isdigit() or (not stripped and not out):
                out.append(stripped)
                expecting_code = False
            elif out:
                out[-1] = out[-1] + b"\\P" + line
            continue
        out.append(line)
        expecting_code = True
    return b"\r\n".join(out) + b"\r\n"


class Handler(BaseHTTPRequestHandler):
    def _answer(self, code, body, kind="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._answer(200, b"ok")
        else:
            self._answer(404, b"not found")

    def do_POST(self):
        route, _, query = self.path.partition("?")
        if route != "/convert":
            self._answer(404, b"not found")
            return
        # ?minimal=1: only the entities (dwg2dxf -m), which viewers read more easily than the full file.
        minimal = "minimal=1" in query.split("&")
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0 or size > MAX_BYTES:
            self._answer(413, b"the drawing is empty or too large")
            return
        folder = tempfile.mkdtemp(prefix="dwg-")
        try:
            source = os.path.join(folder, "drawing.dwg")
            target = os.path.join(folder, "drawing.dxf")
            with open(source, "wb") as out:
                left = size
                while left > 0:
                    chunk = self.rfile.read(min(left, 1024 * 1024))
                    if not chunk:
                        break
                    out.write(chunk)
                    left -= len(chunk)
            try:
                subprocess.run(["dwg2dxf", "-y"] + (["-m"] if minimal else []) + ["-o", target, source], cwd=folder, timeout=TIMEOUT,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except subprocess.TimeoutExpired:
                self._answer(422, b"the drawing took too long to read")
                return
            if not os.path.exists(target) or os.path.getsize(target) == 0:
                self._answer(422, b"the drawing could not be read")
                return
            with open(target, "rb") as dxf:
                self._answer(200, mended(dxf.read()), "application/dxf")
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def log_message(self, *args):
        pass


class Server(ThreadingMixIn, HTTPServer):
    """One thread per drawing (written this way so the Python openSUSE ships, 3.6, runs it)."""
    daemon_threads = True


if __name__ == "__main__":
    Server(("0.0.0.0", 8080), Handler).serve_forever()
