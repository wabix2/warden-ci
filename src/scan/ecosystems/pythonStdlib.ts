// Top-level Python 3 standard library module names (approximate — covers the
// common ones; this is a static list and won't perfectly track every minor
// version, but stdlib module names change rarely enough that this is fine).
export const PYTHON_STDLIB = new Set([
  "abc", "argparse", "array", "ast", "asyncio", "atexit", "base64", "bisect",
  "builtins", "calendar", "collections", "colorsys", "compileall", "concurrent",
  "configparser", "contextlib", "contextvars", "copy", "copyreg", "csv", "ctypes",
  "dataclasses", "datetime", "decimal", "difflib", "dis", "doctest", "email",
  "encodings", "enum", "errno", "faulthandler", "fcntl", "filecmp", "fileinput",
  "fnmatch", "fractions", "ftplib", "functools", "gc", "getopt", "getpass",
  "gettext", "glob", "graphlib", "gzip", "hashlib", "heapq", "hmac", "html",
  "http", "idlelib", "imaplib", "importlib", "inspect", "io", "ipaddress",
  "itertools", "json", "keyword", "linecache", "locale", "logging", "lzma",
  "mailbox", "marshal", "math", "mimetypes", "mmap", "modulefinder",
  "multiprocessing", "netrc", "os", "operator", "optparse", "pathlib",
  "pdb", "pickle", "pickletools", "pkgutil", "platform", "plistlib", "poplib",
  "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr",
  "pydoc", "queue", "quopri", "random", "re", "reprlib", "resource",
  "sched", "secrets", "select", "selectors", "shelve", "shlex", "shutil",
  "signal", "site", "smtplib", "socket", "socketserver", "sqlite3", "ssl",
  "stat", "statistics", "string", "stringprep", "struct", "subprocess",
  "sys", "sysconfig", "syslog", "tarfile", "tempfile", "termios", "textwrap",
  "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib",
  "trace", "traceback", "tracemalloc", "tty", "turtle", "types", "typing",
  "unicodedata", "unittest", "urllib", "uuid", "venv", "warnings", "wave",
  "weakref", "webbrowser", "wsgiref", "xml", "xmlrpc", "zipapp", "zipfile",
  "zipimport", "zlib", "zoneinfo",
]);
