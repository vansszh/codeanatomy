"""
Vercel entry point.

Vercel's Python runtime imports a WSGI callable named `app` from this file.
The project root is added to sys.path first because this module sits in api/
while app.py sits one level up.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402  (import must follow the sys.path change)

# Vercel looks for `app`; the alias keeps other WSGI servers happy too.
application = app
