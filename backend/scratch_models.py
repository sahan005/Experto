import os
import httpx
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")

with httpx.Client() as client:
    response = client.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}")
    if response.status_code == 200:
        models = response.json().get("models", [])
        for m in models:
            name = m.get("name")
            if "flash" in name.lower() or "lite" in name.lower():
                print(name)
    else:
        print(f"Error: {response.status_code} - {response.text}")
