import csv
import io
import re
import base64
from datetime import datetime, timedelta
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

from models import (
    ColumnMappingRequest, ColumnMappingResponse, MappedColumn,
    ConfirmMappingRequest, ChatMessageRequest, ChatMessageResponse,
    UserLogin, Token, UserResponse, VendorStatusUpdate, CategoryRuleCreate
)
import bcrypt
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer

SECRET_KEY = "your-secret-key-here"  # In production, use os.environ
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440 # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        role: str = payload.get("role")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, role FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    conn.close()
    
    if user is None:
        raise credentials_exception
    return dict(user)

async def get_admin_user(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return current_user
from database import init_db, get_db
from gemini import map_columns_via_gemini, narrate_anomalies_via_gemini, validate_and_parse_query, extract_invoice_data_via_gemini


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

@app.post("/api/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (user_data.email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not verify_password(user_data.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
        
    access_token = create_access_token(data={"sub": user["email"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/auth/register", response_model=UserResponse)
async def register(user_data: UserLogin, admin: dict = Depends(get_admin_user)):
    # Only admins can register new users
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (user_data.email,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")
        
    hashed_password = get_password_hash(user_data.password)
    cursor.execute("INSERT INTO users (email, hashed_password, role) VALUES (?, ?, ?)", 
                   (user_data.email, hashed_password, "user"))
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return UserResponse(id=user_id, email=user_data.email, role="user")

@app.get("/api/auth/me", response_model=UserResponse)
async def read_users_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(**current_user)

@app.get("/api/admin/dashboard")
async def get_dashboard_metrics(admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    
    # Simple metrics
    cursor.execute("SELECT COUNT(DISTINCT source_file) as total_invoices FROM invoices")
    total_invoices = cursor.fetchone()["total_invoices"]
    
    cursor.execute("SELECT SUM(total_amount) as total_spend FROM invoices")
    total_spend = cursor.fetchone()["total_spend"] or 0
    
    cursor.execute("SELECT department, SUM(total_amount) as spend FROM invoices GROUP BY department")
    spend_by_dept = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("SELECT vendor_name, COUNT(*) as count FROM invoices GROUP BY vendor_name ORDER BY count DESC LIMIT 5")
    top_vendors = [dict(row) for row in cursor.fetchall()]

    # Daily processing volume (grouped by upload/processing date)
    cursor.execute("""
        SELECT 
            DATE(upload_timestamp) as date, 
            SUM(total_amount) as amount, 
            COUNT(DISTINCT source_file) as count
        FROM invoices 
        WHERE upload_timestamp IS NOT NULL
        GROUP BY DATE(upload_timestamp)
        ORDER BY DATE(upload_timestamp) ASC
    """)
    daily_totals = [dict(row) for row in cursor.fetchall()]

    # Compute anomalies count dynamically for the entire DB
    # 1. Missing PO Numbers
    cursor.execute("""
        SELECT invoice_id, vendor_name 
        FROM invoices 
        GROUP BY source_file, invoice_id, vendor_name 
        HAVING MAX(purchase_order_number) IS NULL OR MAX(purchase_order_number) = ''
    """)
    po_anomalies = len(cursor.fetchall())
    
    # 2. Unexpected Currency (assume 'USD' is expected)
    cursor.execute("SELECT COUNT(DISTINCT invoice_id) as count FROM invoices WHERE currency != 'USD' AND currency IS NOT NULL AND currency != ''")
    currency_anomalies = cursor.fetchone()["count"]
    
    # 3. Duplicate Invoices
    cursor.execute("""
        SELECT invoice_id, COUNT(DISTINCT source_file) as file_count
        FROM invoices 
        WHERE invoice_id IS NOT NULL AND invoice_id != ''
        GROUP BY invoice_id
        HAVING file_count > 1
    """)
    dup_anomalies = len(cursor.fetchall())
    
    # 4. Invalid Date Format
    cursor.execute("SELECT DISTINCT invoice_id, invoice_date FROM invoices WHERE invoice_date IS NOT NULL AND invoice_date != ''")
    date_anomalies = 0
    for row in cursor.fetchall():
        try:
            datetime.strptime(row["invoice_date"], "%Y-%m-%d")
        except ValueError:
            date_anomalies += 1

    # 5. Missing Values (except PO number)
    standard_fields = [
        "invoice_id", "vendor_name", "vendor_id", "invoice_date", "due_date",
        "line_item_description", "quantity", "unit_price", "total_amount",
        "currency", "tax_amount", "discount", "payment_status", "department", "approver_name"
    ]
    cursor.execute("SELECT * FROM invoices")
    all_rows = cursor.fetchall()
    
    seen_missing = set()
    missing_anomalies = 0
    for row in all_rows:
        inv_id = row["invoice_id"] or "Unknown"
        vendor = row["vendor_name"] or "Unknown"
        for col in standard_fields:
            val = row[col]
            if val is None or str(val).strip() == "":
                key = (inv_id, vendor, col)
                if key not in seen_missing:
                    seen_missing.add(key)
                    missing_anomalies += 1
                    
    # 6. Negative Values
    seen_negatives = set()
    negative_anomalies = 0
    for row in all_rows:
        inv_id = row["invoice_id"] or "Unknown"
        vendor = row["vendor_name"] or "Unknown"
        for col in ["quantity", "unit_price", "total_amount", "tax_amount", "discount"]:
            val = row[col]
            if val is not None:
                try:
                    num_val = float(val)
                    if num_val < 0:
                        key = (inv_id, vendor, col, num_val)
                        if key not in seen_negatives:
                            seen_negatives.add(key)
                            negative_anomalies += 1
                except (ValueError, TypeError):
                    pass
                    
    # 7. Vendor Status Warning
    cursor.execute("SELECT vendor_name FROM vendors WHERE status = 'blocked'")
    blocked_vendors = {r["vendor_name"] for r in cursor.fetchall()}
    seen_vendor_warnings = set()
    vendor_warnings = 0
    for row in all_rows:
        vendor = row["vendor_name"] or "Unknown"
        if vendor in blocked_vendors:
            if vendor not in seen_vendor_warnings:
                seen_vendor_warnings.add(vendor)
                vendor_warnings += 1
                
    # 8. Category Pricing Rules
    cursor.execute("SELECT * FROM category_rules")
    category_rules = {r["category_name"]: dict(r) for r in cursor.fetchall()}
    pricing_anomalies = 0
    for row in all_rows:
        desc = row["line_item_description"]
        if desc and desc in category_rules:
            rule = category_rules[desc]
            price = row["unit_price"]
            if price is not None:
                try:
                    p = float(price)
                    if rule["min_price"] is not None and p < rule["min_price"]:
                        pricing_anomalies += 1
                    elif rule["max_price"] is not None and p > rule["max_price"]:
                        pricing_anomalies += 1
                except (ValueError, TypeError):
                    pass
                    
    total_anomalies = (
        po_anomalies + 
        currency_anomalies + 
        dup_anomalies + 
        date_anomalies + 
        missing_anomalies + 
        negative_anomalies + 
        vendor_warnings + 
        pricing_anomalies
    )
    
    conn.close()
    return {
        "total_invoices": total_invoices,
        "total_spend": total_spend,
        "spend_by_department": spend_by_dept,
        "top_vendors": top_vendors,
        "daily_totals": daily_totals,
        "total_anomalies": total_anomalies
    }

@app.get("/api/admin/vendors")
async def get_vendors(admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    # Fetch all unique vendor names from invoices, and left join with their status in vendors table.
    # If not present in vendors table, status defaults to 'active'.
    cursor.execute("""
        SELECT DISTINCT i.vendor_name, COALESCE(v.status, 'active') as status
        FROM invoices i
        LEFT JOIN vendors v ON i.vendor_name = v.vendor_name
        WHERE i.vendor_name IS NOT NULL AND i.vendor_name != ''
    """)
    vendors = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return vendors

@app.get("/api/admin/users", response_model=List[UserResponse])
async def get_users(admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, role FROM users")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users

@app.get("/api/admin/rules")
async def get_rules(admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM category_rules")
    rules = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rules

@app.post("/api/admin/rules")
async def create_rule(rule: CategoryRuleCreate, admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO category_rules (category_name, min_price, max_price, expected_tax_rate) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(category_name) DO UPDATE SET 
            min_price=excluded.min_price, 
            max_price=excluded.max_price, 
            expected_tax_rate=excluded.expected_tax_rate
    """, (rule.category_name, rule.min_price, rule.max_price, rule.expected_tax_rate))
    conn.commit()
    conn.close()
    return {"message": "Rule saved successfully"}

@app.put("/api/admin/vendors/{vendor_name}/status")
async def update_vendor_status(vendor_name: str, status_update: VendorStatusUpdate, admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    # Insert or update
    cursor.execute("""
        INSERT INTO vendors (vendor_name, status) VALUES (?, ?)
        ON CONFLICT(vendor_name) DO UPDATE SET status=excluded.status
    """, (vendor_name, status_update.status))
    conn.commit()
    conn.close()
    return {"message": f"Vendor {vendor_name} status updated to {status_update.status}"}

@app.get("/api/standard_fields")
async def get_standard_fields():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT field_name FROM standard_schema")
    standard_fields = [row["field_name"] for row in cursor.fetchall()]
    conn.close()
    return {"standard_fields": standard_fields}

@app.post("/api/reset_db")
async def reset_db(admin: dict = Depends(get_admin_user)):
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

@app.post("/api/upload/document")
async def upload_document(file: UploadFile = File(...)):
    filename = file.filename.lower()
    if not (filename.endswith('.pdf') or filename.endswith('.png') or filename.endswith('.jpg') or filename.endswith('.jpeg')):
        raise HTTPException(status_code=400, detail="Only PDF, PNG, JPG, and JPEG files are supported")
    
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 20MB limit")
        
    mime_type = "application/pdf"
    if filename.endswith('.png'):
        mime_type = "image/png"
    elif filename.endswith('.jpg') or filename.endswith('.jpeg'):
        mime_type = "image/jpeg"
        
    file_base64 = base64.b64encode(content).decode('utf-8')
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT field_name FROM standard_schema")
    standard_fields = [row["field_name"] for row in cursor.fetchall()]
    conn.close()
    
    extracted_data = await extract_invoice_data_via_gemini(file_base64, mime_type, standard_fields)
    
    # extracted_data is a list of dicts. We will return it to the frontend for preview and ingestion
    return {
        "filename": file.filename,
        "extracted_data": extracted_data
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
    validation_result = await validate_and_parse_query(request.message)
    if not validation_result.get("is_valid", False):
        return ChatMessageResponse(
            response=f"I couldn't process your request: {validation_result.get('reason', 'Invalid query or unrelated topic.')}",
            anomaly_count=0
        )
        
    filters = validation_result.get("filters", {})
    categories = filters.get("categories", ["all"])
    
    conn = get_db()
    cursor = conn.cursor()
    
    anomalies = []
    
    # Get current (most recent) upload file
    cursor.execute("SELECT source_file FROM invoices ORDER BY upload_timestamp DESC LIMIT 1")
    row = cursor.fetchone()
    current_file = row["source_file"] if row else None
    
    # Base WHERE clause from parsed filters
    base_where = "1=1"
    base_params = []
    
    if current_file:
        base_where += " AND source_file = ?"
        base_params.append(current_file)
    
    if filters.get("vendor_name"):
        base_where += " AND vendor_name LIKE ?"
        base_params.append(f"%{filters['vendor_name']}%")
        
    if filters.get("min_amount") is not None:
        base_where += " AND CAST(total_amount AS REAL) >= ?"
        base_params.append(filters["min_amount"])
        
    if filters.get("max_amount") is not None:
        base_where += " AND CAST(total_amount AS REAL) <= ?"
        base_params.append(filters["max_amount"])
        
    if filters.get("start_date"):
        base_where += " AND invoice_date >= ?"
        base_params.append(filters["start_date"])
        
    if filters.get("end_date"):
        base_where += " AND invoice_date <= ?"
        base_params.append(filters["end_date"])
        
    if filters.get("payment_status"):
        base_where += " AND payment_status LIKE ?"
        base_params.append(f"%{filters['payment_status']}%")
        
    # 1. Missing PO Numbers
    if ("all" in categories or "po_number" in categories) and request.context.po_numbers_required:
        query = f"""SELECT invoice_id, vendor_name 
                    FROM invoices 
                    WHERE ({base_where}) 
                    GROUP BY source_file, invoice_id, vendor_name 
                    HAVING MAX(purchase_order_number) IS NULL OR MAX(purchase_order_number) = ''"""
        cursor.execute(query, base_params)
        for row in cursor.fetchall():
            anomalies.append({
                "type": "Missing PO Number",
                "invoice_id": row["invoice_id"],
                "vendor_name": row["vendor_name"]
            })
            
    # 2. Unexpected Currency
    if ("all" in categories or "currency" in categories) and request.context.expected_currency:
        query = f"""SELECT invoice_id, vendor_name, MAX(currency) as currency 
                    FROM invoices 
                    WHERE ({base_where}) AND currency != ? AND currency IS NOT NULL 
                    GROUP BY source_file, invoice_id, vendor_name"""
        cursor.execute(query, base_params + [request.context.expected_currency])
        for row in cursor.fetchall():
            anomalies.append({
                "type": "Unexpected Currency",
                "invoice_id": row["invoice_id"],
                "vendor_name": row["vendor_name"],
                "currency": row["currency"]
            })
            
    # 3. Duplicate Invoices
    if ("all" in categories or "duplicate" in categories) and current_file:
        cursor.execute("SELECT DISTINCT invoice_id, vendor_name FROM invoices WHERE source_file = ?", (current_file,))
        current_props = cursor.fetchall()
        
        for prop in current_props:
            inv_id = prop["invoice_id"]
            vendor = prop["vendor_name"]
            
            if inv_id:
                cursor.execute("SELECT DISTINCT source_file FROM invoices WHERE invoice_id = ? AND source_file != ?", (inv_id, current_file))
                other_files = cursor.fetchall()
                if len(other_files) > 0:
                    anomalies.append({
                        "type": "Duplicate Invoice ID",
                        "invoice_id": inv_id,
                        "vendor_name": vendor,
                        "count": len(other_files) + 1
                    })
            else:
                cursor.execute("SELECT SUM(total_amount) FROM invoices WHERE source_file = ?", (current_file,))
                current_sum = cursor.fetchone()[0]
                
                if current_sum and vendor:
                    cursor.execute("""
                        SELECT source_file FROM invoices 
                        WHERE source_file != ? AND vendor_name = ?
                        GROUP BY source_file
                        HAVING SUM(total_amount) = ?
                    """, (current_file, vendor, current_sum))
                    other_files = cursor.fetchall()
                    if len(other_files) > 0:
                        anomalies.append({
                            "type": "Duplicate Invoice (Exact Match)",
                            "invoice_id": "Unknown",
                            "vendor_name": vendor,
                            "count": len(other_files) + 1
                        })

    # 4. Out of Date Range
    if ("all" in categories or "date" in categories) and (request.context.expected_start_date or request.context.expected_end_date) and not (filters.get("start_date") or filters.get("end_date")):
        start_date = None
        end_date = None
        if request.context.expected_start_date:
            try:
                start_date = datetime.strptime(request.context.expected_start_date, "%Y-%m-%d")
            except ValueError:
                pass
        if request.context.expected_end_date:
            try:
                end_date = datetime.strptime(request.context.expected_end_date, "%Y-%m-%d")
            except ValueError:
                pass
                
        if start_date or end_date:
            query = f"""SELECT invoice_id, vendor_name, MAX(invoice_date) as invoice_date 
                        FROM invoices 
                        WHERE ({base_where}) AND invoice_date IS NOT NULL 
                        GROUP BY source_file, invoice_id, vendor_name"""
            cursor.execute(query, base_params)
            for row in cursor.fetchall():
                try:
                    inv_date = datetime.strptime(row["invoice_date"], "%Y-%m-%d")
                    if (start_date and inv_date < start_date) or (end_date and inv_date > end_date):
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

    # 5. Unexpected Payment Status
    if ("all" in categories or "payment_status" in categories) and request.context.expected_payment_status:
        query = f"""SELECT invoice_id, vendor_name, MAX(payment_status) as payment_status 
                    FROM invoices 
                    WHERE ({base_where}) AND payment_status IS NOT NULL 
                    GROUP BY source_file, invoice_id, vendor_name"""
        cursor.execute(query, base_params)
        for row in cursor.fetchall():
            if row["payment_status"].lower() != request.context.expected_payment_status.lower():
                anomalies.append({
                    "type": "Unexpected Payment Status",
                    "invoice_id": row["invoice_id"],
                    "vendor_name": row["vendor_name"],
                    "payment_status": row["payment_status"]
                })

    query = f"SELECT * FROM invoices WHERE ({base_where})"
    cursor.execute(query, base_params)
    all_rows = cursor.fetchall()

    # 6. Missing Values Across All Columns
    if "all" in categories or "missing_value" in categories or "missing_data" in categories:
        seen_missing = set()
        for row in all_rows:
            inv_id = row["invoice_id"] or "Unknown"
            vendor = row["vendor_name"] or "Unknown"
            
            for col in [
                "invoice_id", "vendor_name", "vendor_id", "invoice_date", "due_date",
                "line_item_description", "quantity", "unit_price", "total_amount",
                "currency", "tax_amount", "discount", "purchase_order_number",
                "payment_status", "department", "approver_name"
            ]:
                # Respect PO number requirement setting
                if col == "purchase_order_number" and not request.context.po_numbers_required:
                    continue
                    
                val = row[col]
                if val is None or str(val).strip() == "":
                    key = (inv_id, vendor, col)
                    if key not in seen_missing:
                        seen_missing.add(key)
                        anomalies.append({
                            "type": "Missing Value",
                            "invoice_id": inv_id,
                            "vendor_name": vendor,
                            "column": col,
                            "description": f"Field '{col}' is missing or null"
                        })

    # 7. Negative Values
    if "all" in categories or "negative_value" in categories:
        seen_negatives = set()
        for row in all_rows:
            inv_id = row["invoice_id"] or "Unknown"
            vendor = row["vendor_name"] or "Unknown"
            
            for col in ["quantity", "unit_price", "total_amount", "tax_amount", "discount"]:
                val = row[col]
                if val is not None:
                    try:
                        num_val = float(val)
                        if num_val < 0:
                            key = (inv_id, vendor, col, num_val)
                            if key not in seen_negatives:
                                seen_negatives.add(key)
                                anomalies.append({
                                    "type": "Negative Value",
                                    "invoice_id": inv_id,
                                    "vendor_name": vendor,
                                    "column": col,
                                    "value": num_val,
                                    "description": f"Field '{col}' has a negative value ({num_val})"
                                })
                    except (ValueError, TypeError):
                        pass

    # 8. Vendor Status Warning (RBAC)
    cursor.execute("SELECT vendor_name FROM vendors WHERE status = 'blocked'")
    blocked_vendors = {r["vendor_name"] for r in cursor.fetchall()}
    
    # 9. Category Pricing Rules (RBAC)
    cursor.execute("SELECT * FROM category_rules")
    category_rules = {r["category_name"]: dict(r) for r in cursor.fetchall()}
    
    seen_vendor_warnings = set()
    for row in all_rows:
        inv_id = row["invoice_id"] or "Unknown"
        vendor = row["vendor_name"] or "Unknown"
        
        if vendor in blocked_vendors:
            if vendor not in seen_vendor_warnings:
                seen_vendor_warnings.add(vendor)
                anomalies.append({
                    "type": "Vendor Status Warning",
                    "invoice_id": inv_id,
                    "vendor_name": vendor,
                    "description": f"Vendor '{vendor}' currently has a suspended status in our system. Verify before proceeding."
                })
                
        desc = row["line_item_description"]
        if desc and desc in category_rules:
            rule = category_rules[desc]
            price = row["unit_price"]
            if price is not None:
                try:
                    p = float(price)
                    if rule["min_price"] is not None and p < rule["min_price"]:
                        anomalies.append({
                            "type": "Pricing Anomaly",
                            "invoice_id": inv_id,
                            "vendor_name": vendor,
                            "description": f"Unit price for '{desc}' (${p}) is below Admin limit (${rule['min_price']})."
                        })
                    if rule["max_price"] is not None and p > rule["max_price"]:
                        anomalies.append({
                            "type": "Pricing Anomaly",
                            "invoice_id": inv_id,
                            "vendor_name": vendor,
                            "description": f"Unit price for '{desc}' (${p}) exceeds Admin limit (${rule['max_price']})."
                        })
                except (ValueError, TypeError):
                    pass

    conn.close()
    
    if not anomalies:
        return ChatMessageResponse(
            response="I analyzed the database based on your criteria, and no anomalies were found.",
            anomaly_count=0
        )
        
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
        "payment_status": "",
        "missing_data": "",
        "negative_value": "",
        "rbac_rule": ""
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
                record["payment_status"] = status_val
            elif status_val not in existing:
                record["payment_status"] = existing + f"; {status_val}"
        elif t == "Missing Value":
            col_val = a.get("column")
            existing = record["missing_data"]
            if not existing:
                record["missing_data"] = f"Missing {col_val}"
            else:
                record["missing_data"] = existing + f"; Missing {col_val}"
        elif t == "Negative Value":
            col_val = a.get("column")
            val_val = a.get("value")
            existing = record["negative_value"]
            if not existing:
                record["negative_value"] = f"Negative {col_val} ({val_val})"
            else:
                record["negative_value"] = existing + f"; Negative {col_val} ({val_val})"
        elif t in ["Vendor Status Warning", "Pricing Anomaly"]:
            desc = a.get("description", "")
            existing = record["rbac_rule"]
            if not existing:
                record["rbac_rule"] = desc
            else:
                record["rbac_rule"] = existing + f"; {desc}"

    raw_csv_lines = [
        "Invoice ID,Vendor,Duplicate Issues,Date Issues,Amount Issues,Currency Issues,PO Issues,Payment Status Issues,Missing Data Issues,Negative Value Issues,RBAC Rule Issues"
    ]
    for inv_id, data in invoice_data.items():
        vendor_escaped = data["vendor"].replace('"', '""')
        dup_escaped = data["duplicate"].replace('"', '""')
        date_escaped = data["date"].replace('"', '""')
        amt_escaped = data["amount"].replace('"', '""')
        curr_escaped = data["currency"].replace('"', '""')
        po_escaped = data["po"].replace('"', '""')
        status_escaped = data["payment_status"].replace('"', '""')
        missing_escaped = data["missing_data"].replace('"', '""')
        negative_escaped = data["negative_value"].replace('"', '""')
        rbac_escaped = data["rbac_rule"].replace('"', '""')
        
        raw_csv_lines.append(
            f'"{inv_id}","{vendor_escaped}","{dup_escaped}","{date_escaped}","{amt_escaped}","{curr_escaped}","{po_escaped}","{status_escaped}","{missing_escaped}","{negative_escaped}","{rbac_escaped}"'
        )
        
    return ChatMessageResponse(
        response=narration,
        anomaly_count=len(filtered_anomalies),
        raw_csv="\n".join(raw_csv_lines)
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8081, reload=True)
