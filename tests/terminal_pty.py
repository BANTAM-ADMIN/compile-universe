"""Run the real terminal program through a Unix pseudo-terminal (stdlib only)."""
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Screen:
    """Small VT character screen, sufficient to inspect our emitted protocol."""
    def __init__(self, cols, rows):
        self.resize(cols, rows)
        self.pending = ""

    def resize(self, cols, rows):
        self.cols, self.rows, self.x, self.y = cols, rows, 0, 0
        self.cells = [[" "] * cols for _ in range(rows)]

    def feed(self, data):
        self.pending += data.decode("ascii", errors="replace")
        while self.pending:
            if self.pending[0] == "\x1b":
                match = re.match(r"\x1b\[([0-9;?]*)([A-Za-z])", self.pending)
                if not match:
                    return
                params, code = match.groups()
                if code in "Hf":
                    y, x = (params or "1;1").split(";")
                    self.x, self.y = min(self.cols - 1, int(x) - 1), min(self.rows - 1, int(y) - 1)
                elif code == "J" and params == "2":
                    self.cells = [[" "] * self.cols for _ in range(self.rows)]
                self.pending = self.pending[match.end():]
            else:
                char, self.pending = self.pending[0], self.pending[1:]
                if " " <= char <= "~":
                    self.cells[self.y][self.x] = char
                    self.x = min(self.cols - 1, self.x + 1)
                elif char == "\r":
                    self.x = 0
                elif char == "\n":
                    self.y = min(self.rows - 1, self.y + 1)

    def text(self):
        return "\n".join("".join(row) for row in self.cells)


class Session:
    def __init__(self, *args, cols=100, rows=36):
        self.master, self.slave = pty.openpty()
        self.original = termios.tcgetattr(self.slave)
        self.screen = Screen(cols, rows)
        self.output = bytearray()
        self.resize(cols, rows)
        self.process = subprocess.Popen(
            [str(ROOT / "universe-terminal"), *args], cwd=ROOT,
            stdin=self.slave, stdout=self.slave, stderr=self.slave,
            env={**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"},
            start_new_session=True,
        )

    def resize(self, cols, rows):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.screen.resize(cols, rows)
        if hasattr(self, "process"):
            self.process.send_signal(signal.SIGWINCH)

    def pump(self, seconds=.1):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([self.master], [], [], min(.04, max(0, until - time.monotonic())))[0]:
                data = os.read(self.master, 262144)
                if not data:
                    break
                self.output.extend(data)
                self.screen.feed(data)

    def until(self, predicate, timeout=15):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.pump(.05)
            if predicate():
                return
        raise AssertionError("Timed out; screen:\n" + self.screen.text())

    def send(self, data):
        os.write(self.master, data.encode("ascii"))

    def close(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            self.until(lambda: self.process.poll() is not None, timeout=5)
        self.pump()
        restored = termios.tcgetattr(self.slave) == self.original
        os.close(self.master)
        os.close(self.slave)
        return restored


class TerminalIntegration(unittest.TestCase):
    def test_interaction_resize_mouse_and_cleanup(self):
        session = Session("--fps", "60", "--colors", "none")
        try:
            session.until(lambda: "ORBIT" in session.screen.text())
            session.send("/Moon\r")
            session.until(lambda: "Moon" in session.screen.text() and "ORBIT" in session.screen.text() and "FLYING TO" not in session.screen.text())
            session.send("m")
            session.until(lambda: "SYSTEM / CLICK TO FLY" in session.screen.text())
            session.resize(60, 40)
            session.until(lambda: "SYSTEM / CLICK TO FLY" in session.screen.text())
            session.pump(.5)
            self.assertNotIn("Resize to at least", session.screen.text())
            session.send("\x1b")
            session.until(lambda: "SYSTEM / CLICK TO FLY" not in session.screen.text())
            session.resize(40, 15)
            session.until(lambda: "Resize to at least 60 x 20" in session.screen.text())
            session.resize(100, 36)
            session.until(lambda: "ORBIT" in session.screen.text())
            # Click the real character button through SGR mouse reports.
            line = session.screen.text().splitlines()[0]
            x = line.index("[find /") + 2
            session.send(f"\x1b[<0;{x};1M\x1b[<0;{x};1m")
            session.until(lambda: "DESTINATIONS" in session.screen.text())
            session.send("\x1b[200~Sirius\x1b[201~")
            session.until(lambda: "/ Sirius_" in session.screen.text())
            session.send("\x03")
            session.until(lambda: session.process.poll() is not None)
            self.assertEqual(session.process.returncode, 0)
            self.assertIn(b"\x1b[?1049l", session.output)
            self.assertIn(b"\x1b[?1006l", session.output)
            self.assertIn(b"\x1b[?25h", session.output)
        finally:
            self.assertTrue(session.close(), "Original terminal settings must be restored")

    def test_truecolor_frames_and_signal_exit(self):
        session = Session("--fps", "60", "--sync", "--frames", "75")
        try:
            session.until(lambda: session.process.poll() is not None)
            self.assertEqual(session.process.returncode, 0)
            self.assertIn(b"38;2;", session.output)
            self.assertIn(b"\x1b[?2026h", session.output)
            self.assertIn(b"\x1b[?1049l", session.output)
            self.assertIn("Earth", session.screen.text())
            self.assertRegex(session.screen.text(), r"[1-6][0-9] fps")
        finally:
            self.assertTrue(session.close())

        session = Session()
        session.until(lambda: "ORBIT" in session.screen.text())
        self.assertTrue(session.close())  # SIGTERM, rather than a keyboard exit.
        self.assertEqual(session.process.returncode, 0)

    def test_orbit_and_wide_short_map(self):
        session = Session("--fps", "60", "--colors", "none", cols=150, rows=26)
        def click(label):
            for y, line in enumerate(session.screen.text().splitlines()):
                if label in line:
                    x = line.index(label) + 2
                    session.send(f"\x1b[<0;{x};{y+1}M\x1b[<0;{x};{y+1}m")
                    return
            self.fail("Missing button: " + label)
        try:
            session.until(lambda: "ORBIT" in session.screen.text())
            session.send("adrrww")
            session.pump(.4)
            self.assertIn("ORBIT", session.screen.text())
            session.send("o")
            session.until(lambda: "FREE" in session.screen.text())
            session.send("ao")
            session.until(lambda: "ORBIT" in session.screen.text())
            session.send("m")
            session.until(lambda: "INNER ORBITS" in session.screen.text())
            self.assertNotIn(":::::", session.screen.text())
            self.assertIn("1-9/9", session.screen.text())
            for name in ["Sun", "Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]:
                self.assertIn("[" + name + "]", session.screen.text())
            def zoom():
                match = re.search(r"([0-9]+\.[0-9]+)x", session.screen.text().splitlines()[3])
                return float(match.group(1)) if match else 0
            session.send("++")
            session.until(lambda: zoom() >= 1.42)
            session.send("\x1b[<65;75;10M" * 4)  # Real wheel-down reports.
            session.until(lambda: 0 < zoom() < .85)
            session.send("\x1b[<64;75;10M" * 6)
            session.until(lambda: zoom() > 1.8)
            click("[fit 0]")
            session.until(lambda: zoom() == 1)
            click("[+]")
            session.until(lambda: zoom() >= 1.19)
            session.send("0")
            session.until(lambda: zoom() == 1)
            click("[inner]")
            session.until(lambda: "INNER SYSTEM" in session.screen.text() and "Fixed positions" in session.screen.text())
            click("[moons >]")
            session.until(lambda: "Earth / MOON FAMILY" in session.screen.text() and "Fixed positions" in session.screen.text())
            click("[Moon]")
            session.until(lambda: "Moon" in session.screen.text() and "ORBIT" in session.screen.text() and "FLYING TO" not in session.screen.text())
            self.assertNotIn("SYSTEM / CLICK TO FLY", session.screen.text())
            session.send("q")
            session.until(lambda: session.process.poll() is not None)
            self.assertEqual(session.process.returncode, 0)
        finally:
            self.assertTrue(session.close())

    def test_suspend_resume(self):
        session = Session("--colors", "none")
        try:
            session.until(lambda: "ORBIT" in session.screen.text())
            session.send("\x1a")
            session.until(lambda: b"\x1b[?1049l" in session.output)
            self.assertEqual(termios.tcgetattr(session.slave), session.original)
            session.process.send_signal(signal.SIGCONT)
            session.until(lambda: session.output.count(b"\x1b[?1049h") == 2)
            session.send("q")
            session.until(lambda: session.process.poll() is not None)
            self.assertEqual(session.process.returncode, 0)
        finally:
            if session.process.poll() is None:
                session.process.send_signal(signal.SIGCONT)
            self.assertTrue(session.close())

    def test_initialization_error_and_no_tty(self):
        session = Session("--destination", "not-a-real-destination")
        try:
            session.until(lambda: session.process.poll() is not None)
            self.assertEqual(session.process.returncode, 1)
            self.assertIn(b"Unknown destination", session.output)
            self.assertIn(b"\x1b[?1049l", session.output)
        finally:
            self.assertTrue(session.close())
        result = subprocess.run([str(ROOT / "universe-terminal")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("--snapshot", result.stderr)
        help_text = subprocess.check_output(["python3", str(ROOT / "run.py"), "terminal", "--help"], text=True)
        self.assertIn("Grand Tour", help_text)


if __name__ == "__main__":
    unittest.main()
