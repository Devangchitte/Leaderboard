"""
Application entry point aliasing app.py
Supports `python main.py`, `uvicorn main:app`, or `uvicorn app:app`
"""

import os
import uvicorn
from app import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
