import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Using gemini-3.1-flash-lite as requested by the user
MODEL_NAME = "gemini-3.1-flash-lite"
BASE_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent"

async def call_gemini(system_instruction: str, prompt: str, temperature: float = 0.7, json_mode: bool = False, inline_data: dict = None):
    url = f"{BASE_URL}?key={GEMINI_API_KEY}"
    
    generation_config = {
        "temperature": temperature,
    }
    
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
        
    parts = [{"text": prompt}]
    if inline_data:
        parts.append({"inlineData": inline_data})

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": [
            {
                "role": "user",
                "parts": parts
            }
        ],
        "generationConfig": generation_config
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            print(f"Gemini API Error: {e}")
            return ""
            
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

async def validate_and_parse_query(user_message: str) -> dict:
    system_instruction = (
        "You are an AI that validates and parses user queries about invoice anomalies into structured database filters.\n"
        "If the query is completely unrelated to invoices, anomalies, vendors, or finance, set 'is_valid' to false and provide a 'reason'.\n"
        "Otherwise, set 'is_valid' to true, and extract any specific filters mentioned in the query into the 'filters' object.\n"
        "The 'categories' array should contain one or more of: ['po_number', 'currency', 'duplicate', 'vendor_name', 'date', 'amount', 'payment_status', 'all'].\n"
        "Only include specific filter values (like vendor_name, min_amount, max_amount, start_date, end_date, payment_status) if explicitly mentioned. Dates should be in YYYY-MM-DD format.\n"
        "Return ONLY a JSON object matching this exact structure:\n"
        "{\n"
        '  "is_valid": true,\n'
        '  "reason": null,\n'
        '  "filters": {\n'
        '    "categories": ["amount"],\n'
        '    "vendor_name": "Acme Corp",\n'
        '    "min_amount": 500,\n'
        '    "max_amount": null,\n'
        '    "start_date": "2023-01-01",\n'
        '    "end_date": null,\n'
        '    "payment_status": "Paid"\n'
        "  }\n"
        "}"
    )
    prompt = f"User query: '{user_message}'\n\nReturn ONLY the JSON object."
    result_text = await call_gemini(system_instruction, prompt, temperature=0.1, json_mode=True)
    try:
        data = json.loads(result_text)
        return data
    except Exception:
        return {"is_valid": False, "reason": "Failed to parse query intent."}

async def narrate_anomalies_via_gemini(query_results: list[dict], user_message: str, context: dict, history: list[dict]):
    system_instruction = (
        "You are an AI assistant for a finance team, specializing in invoice anomaly detection. "
        "You are analyzing a single, specific invoice that was just uploaded. "
        "You are provided with a user's query, context about expected invoice parameters, "
        "and a pre-filtered list of raw JSON data representing the anomalies found in this specific invoice (or duplicate alerts). "
        "Your task is to narrate these findings clearly in plain English, grouped logically. "
        "Be concise, professional, and focus on the anomalies. DO NOT output markdown code blocks."
    )
    
    prompt = (
        f"Context:\n"
        f"Expected Start Date: {context.get('expected_start_date')}\n"
        f"Expected End Date: {context.get('expected_end_date')}\n"
        f"Expected Currency: {context.get('expected_currency')}\n"
        f"PO Numbers Required: {context.get('po_numbers_required')}\n"
        f"Expected Payment Status: {context.get('expected_payment_status')}\n\n"
        f"User Message: {user_message}\n\n"
        f"Raw Database Anomaly Results:\n{json.dumps(query_results, indent=2)}\n\n"
        "Please provide a plain English narration of these anomalies."
    )
    
    return await call_gemini(system_instruction, prompt, temperature=0.2, json_mode=False)

async def extract_invoice_data_via_gemini(file_base64: str, mime_type: str, standard_fields: list[str]):
    system_instruction = (
        "You are an AI data extraction tool. Your job is to extract invoice data and all line items from the provided document. "
        "Return ONLY a JSON array of objects. Each object represents one line item (or the entire invoice if there are no line items). "
        "The keys in each object MUST strictly be chosen from the following standard schema fields, and values must match the expected type (numbers for amounts/quantities, dates in YYYY-MM-DD format if possible). "
        "If a field cannot be found, leave it as null or omit it. DO NOT make up fields. "
        "Standard schema fields available: " + ", ".join(standard_fields)
    )
    prompt = "Extract the invoice data as a JSON array of objects according to the standard schema."
    
    inline_data = {
        "mimeType": mime_type,
        "data": file_base64
    }
    
    result_text = await call_gemini(system_instruction, prompt, temperature=0.1, json_mode=True, inline_data=inline_data)
    try:
        data = json.loads(result_text)
        if isinstance(data, dict):
            return [data] # Ensure list
        return data
    except Exception as e:
        print(f"Error parsing Gemini response for document extraction: {e}")
        return []
