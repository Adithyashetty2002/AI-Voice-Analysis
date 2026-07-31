import json

with open("data/sessions/fedff688-484e-4ec3-8cd5-e0605fb0fcb4.json", "r") as f:
    data = json.load(f)

print(data.get("topic"))
