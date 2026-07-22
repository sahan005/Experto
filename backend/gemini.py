import os
import httpx
import json
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

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
        "The 'categories' array should contain one or more of: ['po_number', 'duplicate', 'vendor_name', 'date', 'amount', 'payment_status', 'missing_value', 'negative_value', 'all'].\n"
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
        "You are provided with a user's query, context about expected invoice parameters, "
        "and a list of raw JSON database anomalies. "
        "Your task is to answer the user's query. IMPORTANT: Focus your answer strictly on addressing the user's specific question. "
        "Do NOT mention or list other unrelated anomalies from the results if they do not relate to the user's question. "
        "For example, if the user asks about a PO number issue, do not bring up date mismatches or pricing issues. "
        "IMPORTANT: When describing database column names, format them in human-readable plain English with spaces instead of underscores (e.g. write 'Invoice ID' instead of 'Invoice_ID', 'Due Date' instead of 'Due_Date', 'Payment Terms' instead of 'Payment_Terms', 'Grand Total' instead of 'Grand_Total', etc.). Do not show raw underscore names to the user. "
        "Be concise, direct, and professional. DO NOT output markdown code blocks."
    )
    
    prompt = (
        f"Context:\n"
        f"Audit Mode: {context.get('audit_mode')}\n"
        f"Expected Start Date: {context.get('expected_start_date')}\n"
        f"Expected End Date: {context.get('expected_end_date')}\n"
        f"Expected PO Number: {context.get('expected_po_number')}\n"
        f"Expected Invoice Date: {context.get('expected_invoice_date')}\n\n"
        f"User Message: {user_message}\n\n"
        f"Raw Database Anomaly Results:\n{json.dumps(query_results, indent=2)}\n\n"
        "Please answer the user's query directly based on the database results, focusing only on the topics they asked about."
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

async def determine_query_type(user_message: str) -> str:
    system_instruction = (
        "You are an AI assistant that classifies user requests into one of two categories:\n"
        "1. 'anomaly_check': If the user is asking to scan for, list, check, or audit anomalies, duplicates, errors, missing values, or negative values on a file or current invoice.\n"
        "2. 'general_question': If the user is asking a general question about the database records, vendors, rules, or users (e.g., counts, sums, pending invoices, top vendors, specific values, averages, status checks, list of invoices/vendors).\n"
        "Return ONLY a JSON object with a single key 'type' whose value is either 'anomaly_check' or 'general_question'."
    )
    prompt = f"User message: '{user_message}'"
    result_text = await call_gemini(system_instruction, prompt, temperature=0.1, json_mode=True)
    try:
        data = json.loads(result_text)
        return data.get("type", "anomaly_check")
    except Exception:
        return "anomaly_check"

async def generate_sqlite_query(user_question: str) -> str:
    system_instruction = (
        "You are an expert SQLite developer. Your job is to translate a user's natural language question into a single, valid, read-only SQLite SELECT query.\n"
        "Do NOT write any INSERT, UPDATE, DELETE, or DROP statements.\n"
        "The database schema is as follows:\n"
        "Table 'invoices':\n"
        "  - Invoice_ID (TEXT)\n"
        "  - Invoice_Date (TEXT, YYYY-MM-DD)\n"
        "  - Due_Date (TEXT, YYYY-MM-DD)\n"
        "  - Vendor_Name (TEXT)\n"
        "  - Vendor_GSTIN (TEXT)\n"
        "  - PO_Number (TEXT)\n"
        "  - Payment_Terms (TEXT)\n"
        "  - Line_No (TEXT)\n"
        "  - Line_Item_Description (TEXT)\n"
        "  - Qty (REAL)\n"
        "  - Unit_Price (REAL)\n"
        "  - Line_Amount (REAL)\n"
        "  - Subtotal (REAL)\n"
        "  - Discount (REAL)\n"
        "  - Tax (REAL)\n"
        "  - Shipping (REAL)\n"
        "  - Grand_Total (REAL)\n"
        "  - Bank_Account (TEXT)\n"
        "  - Invoice_Status (TEXT - e.g., 'Pending', 'Paid', 'Approved')\n"
        "  - source_file (TEXT)\n"
        "  - upload_timestamp (DATETIME)\n"
        "Table 'vendors':\n"
        "  - Vendor_ID (TEXT)\n"
        "  - Vendor_Name (TEXT UNIQUE)\n"
        "  - GSTIN (TEXT)\n"
        "  - Bank_Account (TEXT)\n"
        "  - Payment_Terms (TEXT)\n"
        "  - Status (TEXT NOT NULL, 'Active' or 'Blocked')\n"
        "Table 'category_rules':\n"
        "  - category_name (TEXT UNIQUE)\n"
        "  - min_price (REAL)\n"
        "  - max_price (REAL)\n"
        "  - expected_tax_rate (REAL)\n\n"
        "IMPORTANT Context Rule:\n"
        "Unless the user explicitly asks for 'all time', 'all files', 'entire database', or 'everything in the system', you MUST scope any queries regarding invoices, vendors, amounts, or anomalies to the LATEST UPLOADED FILE only. "
        "To target the latest uploaded file, use: source_file = (SELECT source_file FROM invoices ORDER BY upload_timestamp DESC LIMIT 1)\n\n"
        "Return ONLY a JSON object with a single key 'sql' containing the SQLite SELECT statement. Do not wrap it in markdown code fences."
    )
    prompt = f"User question: '{user_question}'\n\nReturn ONLY the JSON object."
    result_text = await call_gemini(system_instruction, prompt, temperature=0.1, json_mode=True)
    try:
        data = json.loads(result_text)
        return data.get("sql", "")
    except Exception:
        return ""

async def answer_question_with_results(user_question: str, query_results: list, sql_query: str) -> str:
    system_instruction = (
        "You are an AI assistant specialized in corporate finance and invoice processing. "
        "Your task is to answer the user's question using the provided database query results in a friendly, professional, plain English manner. "
        "Do NOT mention SQL query, SQLite, database tables, or internal column names unless asked. "
        "Be concise, direct, and helpful. "
        "DO NOT output markdown code blocks."
    )
    prompt = (
        f"User Question: '{user_question}'\n\n"
        f"SQL Query Executed: {sql_query}\n\n"
        f"Database Results (JSON list): {json.dumps(query_results)}\n\n"
        "Please provide the final answer based on the query results."
    )
    return await call_gemini(system_instruction, prompt, temperature=0.2, json_mode=False)
