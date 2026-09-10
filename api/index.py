import os
import sys
from pathlib import Path

# Resolve all possible backend locations
CURRENT_FILE = Path(__file__).resolve()
CURRENT_DIR = CURRENT_FILE.parent

candidate_paths = [
    CURRENT_DIR.parent / "backend",
    CURRENT_DIR / "backend",
    Path(os.getcwd()) / "backend",
    CURRENT_DIR.parent,
    CURRENT_DIR,
    Path(os.getcwd()),
]

for p in candidate_paths:
    if p.exists() and str(p) not in sys.path:
        sys.path.insert(0, str(p))

# Attempt import with progressive fallbacks
app = None
import_errors = []

try:
    from backend.main import app
except Exception as e1:
    import_errors.append(f"backend.main failed: {e1}")
    try:
        from main import app
    except Exception as e2:
        import_errors.append(f"main failed: {e2}")

if app is None:
    raise RuntimeError(
        f"FastAPI app failed to load on Vercel.\n"
        f"Import errors: {import_errors}\n"
        f"sys.path: {sys.path}\n"
        f"Current dir: {CURRENT_DIR}, CWD: {os.getcwd()}"
    )

__all__ = ["app"]
