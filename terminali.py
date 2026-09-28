"""I terminali della Baracca: sessioni vere (claude o la shell) in una
pseudo-tty, che la pagina mostra con xterm.js nel cassetto TERMINALI.

Il server non esegue mai un comando che arriva dalla pagina: la pagina
sceglie solo uno dei tipi di KINDS e poi manda tasti, come una tastiera.
Ogni terminale ha un id corto (t1, t2, ...) che finisce nell'ambiente come
BARACCA_TERM: gli hook lo scrivono in sessions.json e così la pagina sa
quale clone nella base è quale terminale.

L'uscita resta in un buffer circolare (BUFFER_MAX byte) con la posizione
assoluta del primo byte: chi si collega o si ricollega chiede "da dove"
e riceve solo quello che gli manca, anche dopo aver ricaricato la pagina."""
import errno
import fcntl
import os
import pty
import signal
import struct
import termios
import threading
import time

BUFFER_MAX = 512 * 1024
MAX_TERMS = 8
KINDS = {
    "claude": {"title": "claude", "argv": ["claude"]},
    "continua": {"title": "claude --continue", "argv": ["claude", "--continue"]},
    "shell": {"title": "shell", "argv": None},        # la shell di login dell'utente
}


class Term:
    def __init__(self, tid, kind, cwd, cols=100, rows=30, env=None, argv=None):
        self.id = tid
        self.kind = kind
        self.title = KINDS[kind]["title"]
        self.cwd = cwd
        self.started = int(time.time() * 1000)
        self.buf = bytearray()
        self.base = 0                 # posizione assoluta di buf[0]
        self.alive = True
        self.code = None
        self.cond = threading.Condition()
        argv = argv or KINDS[kind]["argv"] or [os.environ.get("SHELL", "/bin/zsh"), "-l"]
        child_env = dict(os.environ if env is None else env)
        child_env.update(TERM="xterm-256color", COLORTERM="truecolor", BARACCA_TERM=tid)
        pid, fd = pty.fork()
        if pid == 0:                  # figlio: mai tornare nel server
            try:
                os.chdir(cwd)
                os.execvpe(argv[0], argv, child_env)
            except Exception as e:     # noqa: BLE001 - nel figlio si scrive e si esce
                os.write(1, ("\r\nnon parte %s: %s\r\n" % (argv[0], e)).encode())
            os._exit(127)
        self.pid, self.fd = pid, fd
        self.resize(cols, rows)
        threading.Thread(target=self._pump, daemon=True).start()

    @property
    def end(self):
        return self.base + len(self.buf)

    def _pump(self):
        while True:
            try:
                chunk = os.read(self.fd, 65536)
            except OSError as e:
                if e.errno == errno.EINTR:
                    continue
                chunk = b""           # EIO: il figlio ha chiuso la tty
            if not chunk:
                break
            with self.cond:
                self.buf += chunk
                over = len(self.buf) - BUFFER_MAX
                if over > 0:
                    del self.buf[:over]
                    self.base += over
                self.cond.notify_all()
        try:
            _, status = os.waitpid(self.pid, 0)
            code = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            code = None
        try:
            os.close(self.fd)
        except OSError:
            pass
        with self.cond:
            self.alive = False
            self.code = code
            self.cond.notify_all()

    def read_from(self, pos, timeout):
        """(posizione nuova, byte da pos in poi); aspetta al massimo timeout
        secondi che arrivi qualcosa. Se pos è già uscito dal buffer si riparte
        dal primo byte ancora tenuto; se pos è oltre la fine (la pagina parla di
        un t1 di prima di un riavvio del server) si riparte dall'inizio."""
        with self.cond:
            if pos > self.end:
                pos = self.base
            if pos >= self.end and self.alive:
                self.cond.wait(timeout)
            pos = max(pos, self.base)
            data = bytes(self.buf[pos - self.base:])
            return self.end, data

    def write(self, data):
        if not self.alive:
            return False
        view = memoryview(data)
        while view:
            try:
                n = os.write(self.fd, view)
            except OSError:
                return False
            view = view[n:]
        return True

    def resize(self, cols, rows):
        cols = max(20, min(int(cols), 400))
        rows = max(5, min(int(rows), 200))
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass

    def close(self):
        if self.alive:
            try:
                os.killpg(os.getpgid(self.pid), signal.SIGHUP)
            except OSError:
                pass

    def info(self):
        return {"id": self.id, "kind": self.kind, "title": self.title, "cwd": self.cwd,
                "started": self.started, "alive": self.alive, "code": self.code}


class Terminali:
    def __init__(self, cwd, env=None, argv_for=None):
        self.cwd = cwd
        self.env = env
        self.argv_for = argv_for or {}   # per i test: un comando al posto di claude
        self.terms = {}
        self.n = 0
        self.lock = threading.Lock()

    def new(self, kind, cols=100, rows=30):
        if kind not in KINDS:
            raise ValueError("tipo sconosciuto")
        with self.lock:
            # i terminali chiusi da sé restano in lista (si legge com'è finita) ma non contano
            if sum(1 for t in self.terms.values() if t.alive) >= MAX_TERMS:
                raise OverflowError("troppi terminali aperti")
            self.n += 1
            tid = "t%d" % self.n
            cwd = self.cwd if os.path.isdir(self.cwd) else os.path.expanduser("~")
            t = Term(tid, kind, cwd, cols, rows, env=self.env, argv=self.argv_for.get(kind))
            self.terms[tid] = t
            return t

    def get(self, tid):
        return self.terms.get(tid)

    def list(self):
        return [t.info() for t in self.terms.values()]

    def drop(self, tid):
        """Chiude il terminale (se vive) e lo toglie dalla lista."""
        t = self.terms.pop(tid, None)
        if t:
            t.close()
        return t is not None

    def close_all(self):
        for t in list(self.terms.values()):
            t.close()
