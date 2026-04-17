"""
Pytest configuration for citation-service tests.
Adds the citation-service root to sys.path so imports work.
"""
import sys
import os

# Make citation-service root importable
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)
