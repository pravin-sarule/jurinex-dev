import sys
import os
import logging

# Add src to python path
sys.path.append("/home/dell-3/Documents/Jurinex/jurinex-dev/Backend/Template Analyzer Agent/src")

try:
    print("Step 1: Importing app module...")
    from app import app
    print("SUCCESS: app module imported.")
    
    print("Step 2: Checking router registration...")
    routes = [route.path for route in app.routes]
    print(f"Registered routes: {routes}")
    
    required_routes = ["/analysis/upload-template", "/analysis/templates"]
    missing = [r for r in required_routes if r not in routes]
    
    if missing:
        print(f"ERROR: Missing expected routes: {missing}")
        sys.exit(1)
    else:
        print("SUCCESS: All required routes found.")
        
    print("Step 3: Checking DB Models...")
    from models.db_models import UserTemplate, UserTemplateField, UserTemplateAnalysisSection
    print("SUCCESS: DB Models imported.")
    
    print("\nVERIFICATION COMPLETE: Codebase structure is valid.")
    
except Exception as e:
    print(f"\nCRITICAL ERROR during verification: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
