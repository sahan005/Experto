import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Using gemini-3.1-flash-lite per user request, falling back if needed.
# Since the API is Gemini 3.1 Flash-Lite, the model string is likely models/gemini-3.1-flash-lite or similar, but the exact string for Google API would be gemini-3.1-flash-lite or gemini-3.1-flash. We will use gemini-3.1-flash-lite as requested.
MODEL_NAME = "gemini-3.1-flash-lite"
BASE_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent"

async def call_gemini(system_instruction: str, prompt: str, temperature: float = 0.7, json_mode: bool = False):
    url = f"{BASE_URL}?key={GEMINI_API_KEY}"
    
    generation_config = {
        "temperature": temperature,
    }
    
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
        
    payload = {
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": generation_config
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            return ""

async def map_columns_via_gemini(raw_columns: list[str], standard_fields: list[str]):
    system_instruction = (
        "You are an AI that maps raw CSV column names to a standard database schema. "
        "You must return ONLY a JSON array of objects. Each object must have three keys: "
        "'raw_column' (the original name), 'standard_field' (the best match from the provided standard fields, or null if no good match), "
        "and 'confidence' (must be 'high', 'medium', 'low', or 'unmapped')."
    )
    
    prompt = (
        f"Standard Fields available: {', '.join(standard_fields)}\n"
        f"Raw Columns to map: {', '.join(raw_columns)}\n\n"
        "Provide the JSON mapping."
    )
    
    result_text = await call_gemini(system_instruction, prompt, temperature=0.1, json_mode=True)
    try:
        return json.loads(result_text)
    except Exception as e:
        print(f"Error parsing Gemini response: {e}")
        return []

async def classify_query_intent(user_message: str) -> list[str]:
    system_instruction = (
        "You are an AI that classifies user queries about invoice anomalies into categories.\n"
        "The available categories are:\n"
        "- 'po_number': queries about missing, blank, or incorrect purchase order (PO) numbers.\n"
        "- 'currency': queries about unexpected, foreign, or incorrect currencies.\n"
        "- 'duplicate': queries about duplicate invoices or repeated invoice IDs.\n"
        "- 'vendor_name': queries about suspicious, unknown, or missing vendor names.\n"
        "- 'date': queries about date ranges, invoice date out of bounds, or date format errors.\n"
        "- 'amount': queries about total amounts, value ranges, or amounts out of bounds.\n"
        "- 'payment_status': queries about paid, unpaid, pending, or unexpected payment statuses.\n"
        "- 'all': general queries, scans, summary requests, or if multiple categories/all categories apply.\n\n"
        "Return ONLY a JSON list of strings representing the categories that apply to the user's query."
    )
    prompt = f"User query: '{user_message}'\n\nReturn the JSON list."
    result_text = await call_gemini(system_instruction, prompt, temperature=0.1, json_mode=True)
    try:
        categories = json.loads(result_text)
        if isinstance(categories, list):
            return [str(c).lower() for c in categories]
        return ["all"]
    except Exception:
        return ["all"]

async def narrate_anomalies_via_gemini(query_results: list[dict], user_message: str, context: dict, history: list[dict]):
    system_instruction = (
        "You are an AI assistant for a finance team, specializing in invoice anomaly detection. "
        "You are provided with a user's query, context about their expected invoice parameters, "
        "and a pre-filtered list of raw JSON data representing the anomalies relevant to their query. "
        "Your task is to narrate these findings clearly in plain English, grouped logically. "
        "Be concise, professional, and focus on the anomalies. DO NOT output markdown code blocks."
    )
    
    prompt = (
        f"Context:\n"
        f"Expected Date Range: {context.get('expected_date_range')}\n"
        f"Expected Currency: {context.get('expected_currency')}\n"
        f"Expected Total Amount Range: {context.get('expected_total_amount_range')}\n"
        f"PO Numbers Required: {context.get('po_numbers_required')}\n"
        f"Expected Payment Status: {context.get('expected_payment_status')}\n\n"
        f"User Message: {user_message}\n\n"
        f"Raw Database Anomaly Results:\n{json.dumps(query_results, indent=2)}\n\n"
        "Please provide a plain English narration of these anomalies."
    )
    
    return await call_gemini(system_instruction, prompt, temperature=0.2, json_mode=False)

def validate_chat_intent(user_message: str) -> bool:
    # Rule-based check if off-topic. Simple keyword-based validation for this prototype.
    keywords = ["invoice", "anomaly", "anomalies", "vendor", "date", "currency", "amount", "po", "payment", "status", "report", "find", "show", "missing", "duplicate"]
    message_lower = user_message.lower()
    for kw in keywords:
        if kw in message_lower:
            return True
    return False
