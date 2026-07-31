import os
import ast
import importlib

def get_imports(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            tree = ast.parse(f.read())
        except SyntaxError:
            return set()
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.add(node.module.split('.')[0])
    return imports

missing = set()
local_modules = {f[:-3] for f in os.listdir('.') if f.endswith('.py')}

for root, dirs, files in os.walk('.'):
    if '.venv' in root or 'local-python-dev' in root:
        continue
    for f in files:
        if f.endswith('.py'):
            for imp in get_imports(os.path.join(root, f)):
                if imp in local_modules:
                    continue
                try:
                    importlib.import_module(imp)
                except ImportError:
                    missing.add(imp)

print("MISSING_MODULES:", missing)
