import os
import httpx
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={api_key}"

payload = {
    "contents": [{"role": "user", "parts": [{"text": "Hello"}]}]
}
headers = {"Content-Type": "application/json"}

with httpx.Client() as client:
    resp = client.post(url, json=payload, headers=headers)
    print(resp.status_code)
    if resp.status_code != 200:
        print(resp.text)
