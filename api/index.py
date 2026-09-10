import sys
from pathlib import Path

# Resolve backend path relative to this file
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Import the configured FastAPI instance
from backend.main import app

# Export app for Vercel ASGI runtime
__all__ = ["app"]
