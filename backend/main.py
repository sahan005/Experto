import csv
import io
import re
from datetime import datetime, timedelta
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

from models import (
    ColumnMappingRequest, ColumnMappingResponse, MappedColumn,
    ConfirmMappingRequest, ChatMessageRequest, ChatMessageResponse
)
from database import init_db, get_db
from gemini import map_columns_via_gemini, narrate_anomalies_via_gemini, validate_chat_intent, classify_query_intent

def parse_date_range(range_str: str, max_db_date_str: str) -> tuple[datetime | None, datetime | None]:
    if not range_str:
        return None, None
        
    # Try YYYY-MM-DD to YYYY-MM-DD
    match = re.search(r"(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})", range_str)
    if match:
        try:
            start = datetime.strptime(match.group(1), "%Y-%m-%d")
            end = datetime.strptime(match.group(2), "%Y-%m-%d")
            return start, end
        except ValueError:
            pass
            
    # Try "Last X days"
    match = re.search(r"last\s+(\d+)\s+days", range_str, re.IGNORECASE)
    if match and max_db_date_str:
        try:
            days = int(match.group(1))
            end = datetime.strptime(max_db_date_str, "%Y-%m-%d")
            start = end - timedelta(days=days)
            return start, end
        except ValueError:
            pass
            
    return None, None

def parse_amount_range(range_str: str) -> tuple[float | None, float | None]:
    if not range_str:
        return None, None
        
    # Try "X - Y" or "X to Y"
    match = re.search(r"([\d\.]+)\s*(?:-|to)\s*([\d\.]+)", range_str)
    if match:
        try:
            return float(match.group(1)), float(match.group(2))
        except ValueError:
            pass
    return None, None

app = FastAPI(title="Invoice Anomaly Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    init_db()

@app.get("/api/standard_fields")
async def get_standard_fields():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT field_name FROM standard_schema")
    standard_fields = [row["field_name"] for row in cursor.fetchall()]
    conn.close()
    return {"standard_fields": standard_fields}

@app.post("/api/reset_db")
async def reset_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM invoices")
    conn.commit()
    conn.close()
    return {"message": "Database reset successfully. All invoices cleared."}

@app.post("/api/upload/csv")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    content = await file.read()
    try:
        text = content.decode('utf-8-sig') # Handle BOM
    except UnicodeDecodeError:
        try:
            text = content.decode('latin-1')
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode CSV file")
            
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        raise HTTPException(status_code=400, detail="CSV file is empty")
        
    rows = []
    for i, row in enumerate(reader):
        if i >= 10: # Just take top 10 for preview
            break
        rows.append(row)
        
    # Also count total rows
    reader = csv.reader(io.StringIO(text))
    next(reader) # skip header
    row_count = sum(1 for _ in reader)
    
    return {
        "filename": file.filename,
        "row_count": row_count,
        "column_count": len(headers),
        "headers": headers,
        "preview_rows": rows
    }

@app.post("/api/map_columns", response_model=ColumnMappingResponse)
async def map_columns(request: ColumnMappingRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT field_name FROM standard_schema")
    standard_fields = [row["field_name"] for row in cursor.fetchall()]
    conn.close()
    
    mappings = await map_columns_via_gemini(request.raw_columns, standard_fields)
    
    # ensure response matches model
    validated_mappings = []
    for m in mappings:
        validated_mappings.append(MappedColumn(
            raw_column=m.get("raw_column", ""),
            standard_field=m.get("standard_field"),
            confidence=m.get("confidence", "unmapped")
        ))
        
    return ColumnMappingResponse(mappings=validated_mappings)

@app.post("/api/confirm_mapping")
async def confirm_mapping(request: ConfirmMappingRequest):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT field_name FROM standard_schema")
    standard_fields = [row["field_name"] for row in cursor.fetchall()]
    
    inserted = 0
    for row in request.rows:
        # Filter only valid standard fields
        data = {k: v for k, v in row.data.items() if k in standard_fields}
        
        if not data:
            continue
            
        columns = list(data.keys()) + ["source_file"]
        placeholders = ", ".join(["?"] * len(columns))
        values = list(data.values()) + [row.source_file]
        
        query = f"INSERT INTO invoices ({', '.join(columns)}) VALUES ({placeholders})"
        try:
            cursor.execute(query, values)
            inserted += 1
        except Exception as e:
            print(f"Error inserting row: {e}")
            
    conn.commit()
    conn.close()
    
    return {"message": f"Successfully inserted {inserted} rows"}

@app.post("/api/chat", response_model=ChatMessageResponse)
async def chat(request: ChatMessageRequest):
    if not validate_chat_intent(request.message):
        return ChatMessageResponse(
            response="I am an invoice anomaly detection assistant. Please ask me about invoice anomalies, unexpected dates, currencies, missing PO numbers, or unknown vendors.",
            anomaly_count=0
        )
        
    # Query database for anomalies based on context
    # This is a simplified anomaly query logic
    conn = get_db()
    cursor = conn.cursor()
    
    anomalies = []
    
    # 1. Missing PO Numbers
    if request.context.po_numbers_required:
        cursor.execute("SELECT * FROM invoices WHERE purchase_order_number IS NULL OR purchase_order_number = ''")
        for row in cursor.fetchall():
            anomalies.append({
                "type": "Missing PO Number",
                "invoice_id": row["invoice_id"],
                "vendor_name": row["vendor_name"]
            })
            
    # 2. Unexpected Currency
    if request.context.expected_currency:
        cursor.execute("SELECT * FROM invoices WHERE currency != ? AND currency IS NOT NULL", (request.context.expected_currency,))
        for row in cursor.fetchall():
            anomalies.append({
                "type": "Unexpected Currency",
                "invoice_id": row["invoice_id"],
                "vendor_name": row["vendor_name"],
                "currency": row["currency"]
            })
            
    # 3. Duplicate Invoices
    cursor.execute("""
        SELECT invoice_id, vendor_name, COUNT(*) as count 
        FROM invoices 
        WHERE invoice_id IS NOT NULL 
        GROUP BY invoice_id, vendor_name 
        HAVING count > 1
    """)
    for row in cursor.fetchall():
        anomalies.append({
            "type": "Duplicate Invoice ID",
            "invoice_id": row["invoice_id"],
            "vendor_name": row["vendor_name"],
            "count": row["count"]
        })

    # 4. Out of Date Range
    if request.context.expected_date_range:
        cursor.execute("SELECT MAX(invoice_date) FROM invoices")
        max_row = cursor.fetchone()
        max_db_date = max_row[0] if max_row else None
        
        start_date, end_date = parse_date_range(request.context.expected_date_range, max_db_date)
        if start_date and end_date:
            cursor.execute("SELECT * FROM invoices WHERE invoice_date IS NOT NULL")
            for row in cursor.fetchall():
                try:
                    inv_date = datetime.strptime(row["invoice_date"], "%Y-%m-%d")
                    if inv_date < start_date or inv_date > end_date:
                        anomalies.append({
                            "type": "Date Out of Range",
                            "invoice_id": row["invoice_id"],
                            "vendor_name": row["vendor_name"],
                            "invoice_date": row["invoice_date"]
                        })
                except ValueError:
                    anomalies.append({
                        "type": "Invalid Date Format",
                        "invoice_id": row["invoice_id"],
                        "vendor_name": row["vendor_name"],
                        "invoice_date": row["invoice_date"]
                    })

    # 5. Out of Amount Range
    if request.context.expected_total_amount_range:
        min_amount, max_amount = parse_amount_range(request.context.expected_total_amount_range)
        if min_amount is not None and max_amount is not None:
            cursor.execute("SELECT * FROM invoices WHERE total_amount IS NOT NULL")
            for row in cursor.fetchall():
                try:
                    amount = float(row["total_amount"])
                    if amount < min_amount or amount > max_amount:
                        anomalies.append({
                            "type": "Amount Out of Range",
                            "invoice_id": row["invoice_id"],
                            "vendor_name": row["vendor_name"],
                            "total_amount": row["total_amount"]
                        })
                except ValueError:
                    anomalies.append({
                        "type": "Invalid Amount Format",
                        "invoice_id": row["invoice_id"],
                        "vendor_name": row["vendor_name"],
                        "total_amount": row["total_amount"]
                    })

    # 6. Unexpected Payment Status
    if request.context.expected_payment_status:
        cursor.execute("SELECT * FROM invoices WHERE payment_status IS NOT NULL")
        for row in cursor.fetchall():
            if row["payment_status"].lower() != request.context.expected_payment_status.lower():
                anomalies.append({
                    "type": "Unexpected Payment Status",
                    "invoice_id": row["invoice_id"],
                    "vendor_name": row["vendor_name"],
                    "payment_status": row["payment_status"]
                })

    conn.close()
    
    if not anomalies:
        return ChatMessageResponse(
            response="I analyzed the invoices based on your criteria, and no anomalies were found.",
            anomaly_count=0
        )
        
    # Classify the user query to filter anomalies in Python first
    categories = await classify_query_intent(request.message)
    
    filtered_anomalies = []
    if "all" in categories:
        filtered_anomalies = anomalies
    else:
        for a in anomalies:
            # Check po_number
            if "po_number" in categories and a["type"] == "Missing PO Number":
                filtered_anomalies.append(a)
            # Check currency
            elif "currency" in categories and a["type"] == "Unexpected Currency":
                filtered_anomalies.append(a)
            # Check duplicate
            elif "duplicate" in categories and a["type"] == "Duplicate Invoice ID":
                filtered_anomalies.append(a)
            # Check vendor_name
            elif "vendor_name" in categories:
                v_name = a.get("vendor_name")
                if not v_name or v_name in ["Unknown Vendor XYZ", "Ghost Supplies Co", "Shady Deals Pvt Ltd", "None"]:
                    filtered_anomalies.append(a)
            # Check date
            elif "date" in categories and a["type"] in ["Date Out of Range", "Invalid Date Format"]:
                filtered_anomalies.append(a)
            # Check amount
            elif "amount" in categories and a["type"] in ["Amount Out of Range", "Invalid Amount Format"]:
                filtered_anomalies.append(a)
            # Check payment_status
            elif "payment_status" in categories and a["type"] == "Unexpected Payment Status":
                filtered_anomalies.append(a)
                    
        # If no specific categories matched or result is empty, fallback to all anomalies
        if not filtered_anomalies:
            filtered_anomalies = anomalies
        
    narration = await narrate_anomalies_via_gemini(
        query_results=filtered_anomalies,
        user_message=request.message,
        context=request.context.dict(),
        history=request.history
    )
    
    from collections import defaultdict
    
    # Wide-format structure: one row per invoice, dedicated column for each issue type
    invoice_data = defaultdict(lambda: {
        "vendor": "Unknown",
        "duplicate": "",
        "date": "",
        "amount": "",
        "currency": "",
        "po": "",
        "payment_status": ""
    })
    
    for a in filtered_anomalies:
        inv_id = a.get("invoice_id") or "UNKNOWN_ID"
        record = invoice_data[inv_id]
        
        # Capture the actual vendor name if we don't have one yet
        if a.get("vendor_name") and a.get("vendor_name") != "None" and record["vendor"] == "Unknown":
            record["vendor"] = a.get("vendor_name")
            
        t = a.get("type")
        if t == "Duplicate Invoice ID":
            record["duplicate"] = f"Duplicate ({a.get('count')} occurrences)"
        elif t in ["Date Out of Range", "Invalid Date Format"]:
            date_val = a.get("invoice_date") or "Missing"
            existing = record["date"]
            if not existing:
                record["date"] = f"Out of range ({date_val})"
            elif date_val not in existing:
                record["date"] = existing.rstrip(")") + f"; {date_val})"
        elif t in ["Amount Out of Range", "Invalid Amount Format"]:
            amt_val = str(a.get("total_amount") or "Missing")
            existing = record["amount"]
            if not existing:
                record["amount"] = f"Out of range ({amt_val})"
            elif amt_val not in existing:
                record["amount"] = existing.rstrip(")") + f"; {amt_val})"
        elif t == "Unexpected Currency":
            curr_val = a.get("currency") or "Missing"
            existing = record["currency"]
            if not existing:
                record["currency"] = f"Unexpected ({curr_val})"
            elif curr_val not in existing:
                record["currency"] = existing.rstrip(")") + f"; {curr_val})"
        elif t == "Missing PO Number":
            record["po"] = "Missing PO"
        elif t == "Unexpected Payment Status":
            status_val = a.get("payment_status") or "Missing"
            existing = record["payment_status"]
            if not existing:
                record["payment_status"] = f"Unexpected ({status_val})"
            elif status_val not in existing:
                record["payment_status"] = existing.rstrip(")") + f"; {status_val})"

    raw_csv_lines = [
        "Invoice ID,Vendor,Duplicate Issues,Date Issues,Amount Issues,Currency Issues,PO Issues,Payment Status Issues"
    ]
    for inv_id, data in invoice_data.items():
        vendor_escaped = data["vendor"].replace('"', '""')
        dup_escaped = data["duplicate"].replace('"', '""')
        date_escaped = data["date"].replace('"', '""')
        amt_escaped = data["amount"].replace('"', '""')
        curr_escaped = data["currency"].replace('"', '""')
        po_escaped = data["po"].replace('"', '""')
        status_escaped = data["payment_status"].replace('"', '""')
        
        raw_csv_lines.append(
            f'"{inv_id}","{vendor_escaped}","{dup_escaped}","{date_escaped}","{amt_escaped}","{curr_escaped}","{po_escaped}","{status_escaped}"'
        )
        
    return ChatMessageResponse(
        response=narration,
        anomaly_count=len(filtered_anomalies),
        raw_csv="\n".join(raw_csv_lines)
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
