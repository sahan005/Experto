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
    UserLogin, Token, UserResponse, VendorStatusUpdate, CategoryRuleCreate, VendorCreate
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

def parse_float(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s:
        return None
    is_negative = False
    if s.startswith("(") and s.endswith(")"):
        is_negative = True
        s = s[1:-1]
    s = re.sub(r"[^\d.-]", "", s)
    if not s or s == "-":
        return None
    try:
        num = float(s)
        return -num if is_negative else num
    except ValueError:
        return None

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
from gemini import (
    map_columns_via_gemini, narrate_anomalies_via_gemini, validate_and_parse_query, 
    extract_invoice_data_via_gemini, determine_query_type, generate_sqlite_query, 
    answer_question_with_results
)


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


def format_field_name(name: str) -> str:
    if not name:
        return ""
    if name == "Qty":
        return "Quantity"
    return name.replace("_", " ")

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
    
    # Simple metrics excluding duplicates (where the same Invoice_ID exists in an earlier file)
    cursor.execute("""
        SELECT COUNT(DISTINCT source_file) as total_invoices 
        FROM invoices i
        WHERE i.Invoice_ID IS NULL OR i.Invoice_ID = '' OR i.source_file = (
            SELECT source_file FROM invoices i2 WHERE i2.Invoice_ID = i.Invoice_ID ORDER BY i2.id ASC LIMIT 1
        )
    """)
    total_invoices = cursor.fetchone()["total_invoices"]
    
    cursor.execute("""
        SELECT SUM(i.Line_Amount) as total_spend 
        FROM invoices i
        WHERE i.Invoice_ID IS NULL OR i.Invoice_ID = '' OR i.source_file = (
            SELECT source_file FROM invoices i2 WHERE i2.Invoice_ID = i.Invoice_ID ORDER BY i2.id ASC LIMIT 1
        )
    """)
    total_spend = cursor.fetchone()["total_spend"] or 0
    
    cursor.execute("""
        SELECT i.Bank_Account, SUM(i.Line_Amount) as spend 
        FROM invoices i
        WHERE i.Invoice_ID IS NULL OR i.Invoice_ID = '' OR i.source_file = (
            SELECT source_file FROM invoices i2 WHERE i2.Invoice_ID = i.Invoice_ID ORDER BY i2.id ASC LIMIT 1
        )
        GROUP BY i.Bank_Account
    """)
    spend_by_dept = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("""
        SELECT i.Vendor_Name, COUNT(*) as count 
        FROM invoices i
        WHERE i.Invoice_ID IS NULL OR i.Invoice_ID = '' OR i.source_file = (
            SELECT source_file FROM invoices i2 WHERE i2.Invoice_ID = i.Invoice_ID ORDER BY i2.id ASC LIMIT 1
        )
        GROUP BY i.Vendor_Name 
        ORDER BY count DESC 
        LIMIT 5
    """)
    top_vendors = [dict(row) for row in cursor.fetchall()]

    # Daily processing volume (grouped by upload/processing date) excluding duplicates
    cursor.execute("""
        SELECT 
            DATE(i.upload_timestamp) as date, 
            SUM(i.Line_Amount) as amount, 
            COUNT(DISTINCT i.source_file) as count
        FROM invoices i 
        WHERE i.upload_timestamp IS NOT NULL AND (
            i.Invoice_ID IS NULL OR i.Invoice_ID = '' OR i.source_file = (
                SELECT source_file FROM invoices i2 WHERE i2.Invoice_ID = i.Invoice_ID ORDER BY i2.id ASC LIMIT 1
            )
        )
        GROUP BY DATE(i.upload_timestamp)
        ORDER BY DATE(i.upload_timestamp) ASC
    """)
    daily_totals = [dict(row) for row in cursor.fetchall()]

    # Compute anomalies count dynamically for the entire DB
    # 1. Missing PO Numbers
    cursor.execute("""
        SELECT Invoice_ID, Vendor_Name 
        FROM invoices 
        GROUP BY source_file, Invoice_ID, Vendor_Name 
        HAVING MAX(PO_Number) IS NULL OR MAX(PO_Number) = ''
    """)
    po_anomalies = len(cursor.fetchall())
    
    # 2. Unexpected Currency (assume 'USD' is expected)
    cursor.execute("SELECT COUNT(DISTINCT Invoice_ID) as count FROM invoices WHERE 1=0")
    currency_anomalies = cursor.fetchone()["count"]
    
    # 3. Duplicate Invoices
    cursor.execute("""
        SELECT Invoice_ID, COUNT(DISTINCT source_file) as file_count
        FROM invoices 
        WHERE Invoice_ID IS NOT NULL AND Invoice_ID != ''
        GROUP BY Invoice_ID
        HAVING file_count > 1
    """)
    dup_anomalies = len(cursor.fetchall())
    
    # 4. Invalid Date Format
    cursor.execute("SELECT DISTINCT Invoice_ID, Invoice_Date FROM invoices WHERE Invoice_Date IS NOT NULL AND Invoice_Date != ''")
    date_anomalies = 0
    for row in cursor.fetchall():
        try:
            datetime.strptime(row["Invoice_Date"], "%Y-%m-%d")
        except ValueError:
            date_anomalies += 1

    # 5. Missing Values (except PO number)
    standard_fields = [
        "Invoice_ID", "Invoice_Date", "Due_Date", "Vendor_Name", "Vendor_GSTIN", 
        "PO_Number", "Payment_Terms", "Line_No", "Line_Item_Description", "Qty", 
        "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", 
        "Grand_Total", "Bank_Account", "Invoice_Status"
    ]
    cursor.execute("SELECT * FROM invoices")
    all_rows = cursor.fetchall()
    
    seen_missing = set()
    missing_anomalies = 0
    for row in all_rows:
        inv_id = row["Invoice_ID"] or "Unknown"
        vendor = row["Vendor_Name"] or "Unknown"
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
        inv_id = row["Invoice_ID"] or "Unknown"
        vendor = row["Vendor_Name"] or "Unknown"
        for col in ["Qty", "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", "Grand_Total"]:
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
                    
    # 7. Vendor Status and Mismatch Warnings (Vendor Master checks)
    cursor.execute("SELECT Vendor_ID, Vendor_Name, GSTIN, Bank_Account, Payment_Terms, Status FROM vendors")
    master_vendors = {r["Vendor_Name"]: dict(r) for r in cursor.fetchall()}
    seen_vendor_warnings = set()
    vendor_warnings = 0
    for row in all_rows:
        inv_id = row["Invoice_ID"] or "Unknown"
        vendor = row["Vendor_Name"] or "Unknown"
        inv_gstin = row["Vendor_GSTIN"]
        inv_bank = row["Bank_Account"]
        inv_terms = row["Payment_Terms"]
        
        if not vendor or vendor.strip() == "":
            continue
            
        # Check unknown
        if vendor not in master_vendors:
            key = (inv_id, vendor, "Unknown Vendor")
            if key not in seen_vendor_warnings:
                seen_vendor_warnings.add(key)
                vendor_warnings += 1
            continue
            
        master = master_vendors[vendor]
        
        # Check blocked
        if master["Status"].strip().title() == "Blocked":
            key = (inv_id, vendor, "Blocked Vendor")
            if key not in seen_vendor_warnings:
                seen_vendor_warnings.add(key)
                vendor_warnings += 1
                
        # Check GSTIN mismatch
        if inv_gstin and master["GSTIN"] and str(inv_gstin).strip() != str(master["GSTIN"]).strip():
            key = (inv_id, vendor, "GSTIN Mismatch")
            if key not in seen_vendor_warnings:
                seen_vendor_warnings.add(key)
                vendor_warnings += 1
                
        # Check Bank mismatch
        if inv_bank and master["Bank_Account"] and str(inv_bank).strip() != str(master["Bank_Account"]).strip():
            key = (inv_id, vendor, "Bank Account Mismatch")
            if key not in seen_vendor_warnings:
                seen_vendor_warnings.add(key)
                vendor_warnings += 1
                
        # Check Terms mismatch
        if inv_terms and master["Payment_Terms"] and str(inv_terms).strip() != str(master["Payment_Terms"]).strip():
            key = (inv_id, vendor, "Payment Terms Mismatch")
            if key not in seen_vendor_warnings:
                seen_vendor_warnings.add(key)
                vendor_warnings += 1
                
    # 8. Category Pricing Rules
    cursor.execute("SELECT * FROM category_rules")
    category_rules = {r["category_name"]: dict(r) for r in cursor.fetchall()}
    pricing_anomalies = 0
    for row in all_rows:
        desc = row["Line_Item_Description"]
        if desc and desc in category_rules:
            rule = category_rules[desc]
            price = row["Unit_Price"]
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
    cursor.execute("""
        SELECT Vendor_ID, Vendor_Name, GSTIN, Bank_Account, Payment_Terms, Status
        FROM vendors
    """)
    vendors = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return vendors

@app.post("/api/admin/vendors")
async def add_vendor(vendor: VendorCreate, admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO vendors (Vendor_ID, Vendor_Name, GSTIN, Bank_Account, Payment_Terms, Status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (vendor.Vendor_ID, vendor.Vendor_Name, vendor.GSTIN, vendor.Bank_Account, vendor.Payment_Terms, vendor.Status or "Active"))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail="Vendor ID or Vendor Name already exists")
    conn.close()
    return {"message": "Vendor added successfully"}

@app.delete("/api/admin/vendors/{Vendor_ID}")
async def delete_vendor(Vendor_ID: str, admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM vendors WHERE Vendor_ID = ?", (Vendor_ID,))
    conn.commit()
    conn.close()
    return {"message": f"Vendor {Vendor_ID} deleted successfully"}

@app.get("/api/admin/users", response_model=List[UserResponse])
async def get_users(admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, role FROM users")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users

@app.delete("/api/admin/users/{email}")
async def delete_user(email: str, admin: dict = Depends(get_admin_user)):
    if email == admin["email"]:
        raise HTTPException(status_code=400, detail="Cannot delete currently logged-in admin")
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    cursor.execute("DELETE FROM users WHERE email = ?", (email,))
    conn.commit()
    conn.close()
    return {"message": f"User {email} deleted successfully"}


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

@app.put("/api/admin/vendors/{Vendor_Name}/status")
async def update_vendor_status(Vendor_Name: str, status_update: VendorStatusUpdate, admin: dict = Depends(get_admin_user)):
    conn = get_db()
    cursor = conn.cursor()
    new_status = status_update.status.strip().title()
    cursor.execute("""
        UPDATE vendors SET Status = ? WHERE Vendor_Name = ?
    """, (new_status, Vendor_Name))
    conn.commit()
    conn.close()
    return {"message": f"Vendor {Vendor_Name} status updated to {new_status}"}

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

def generate_highlighted_csv(current_file: str, context, conn) -> str:
    cursor = conn.cursor()
    
    # Fetch blocked vendors
    cursor.execute("SELECT Vendor_Name FROM vendors WHERE Status = 'Blocked'")
    blocked_vendors = {r["Vendor_Name"] for r in cursor.fetchall()}
    
    # Fetch category pricing rules
    cursor.execute("SELECT * FROM category_rules")
    category_rules = {r["category_name"]: dict(r) for r in cursor.fetchall()}
    
    # Fetch all rows for this file
    cursor.execute("SELECT * FROM invoices WHERE source_file = ? ORDER BY id ASC", (current_file,))
    rows = [dict(r) for r in cursor.fetchall()]
    
    # Parse context dates
    start_date = None
    end_date = None
    if context.expected_start_date:
        try:
            start_date = datetime.strptime(context.expected_start_date, "%Y-%m-%d")
        except ValueError:
            pass
    if context.expected_end_date:
        try:
            end_date = datetime.strptime(context.expected_end_date, "%Y-%m-%d")
        except ValueError:
            pass

    columns = [
        "Invoice_ID", "Invoice_Date", "Due_Date", "Vendor_Name", "Vendor_GSTIN", 
        "PO_Number", "Payment_Terms", "Line_No", "Line_Item_Description", "Qty", 
        "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", 
        "Grand_Total", "Bank_Account", "Invoice_Status"
    ]
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write headers
    writer.writerow([col.replace('_', ' ').title() for col in columns])
    
    for row in rows:
        highlighted_row = []
        inv_id = row.get("Invoice_ID")
        
        # Check duplicate invoice ID
        is_duplicate = False
        if inv_id:
            cursor.execute("SELECT DISTINCT source_file FROM invoices WHERE Invoice_ID = ? AND source_file != ?", (inv_id, current_file))
            if len(cursor.fetchall()) > 0:
                is_duplicate = True
        
        for col in columns:
            val = row.get(col)
            val_str = str(val) if val is not None else ""
            anomalies = []
            
            # Check individual column anomalies
            # 1. Missing Values
            is_missing = val is None or val_str.strip() == ""
            if is_missing:
                # Respect PO numbers required setting
                if col == "PO_Number":
                    if context.audit_mode == "single" and context.expected_po_number:
                        anomalies.append("Missing PO Number")
                else:
                    anomalies.append("Missing Value")
            
            # If not missing, check other conditions
            else:
                # 2. Duplicate Invoice ID
                if col == "Invoice_ID" and is_duplicate:
                    anomalies.append("Duplicate Invoice ID")
                
                # 3. Out of Date Range / Invalid Date
                if col in ["Invoice_Date", "Due_Date"]:
                    try:
                        dt = datetime.strptime(val_str.strip(), "%Y-%m-%d")
                        if col == "Invoice_Date":
                            if (start_date and dt < start_date) or (end_date and dt > end_date):
                                anomalies.append("Date Out of Range")
                    except ValueError:
                        anomalies.append("Invalid Date Format")
                
                # 4. Negative and Zero Values
                if col in ["Qty", "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", "Grand_Total"]:
                    num_val = parse_float(val)
                    if num_val is not None:
                        if num_val < 0:
                            anomalies.append("Negative Value")
                        elif num_val == 0 and col in ["Qty", "Unit_Price", "Line_Amount"]:
                            anomalies.append("Zero Value")
                
                # 5. Blocked Vendor
                if col == "Vendor_Name" and val_str in blocked_vendors:
                    anomalies.append("Vendor Suspended")
                
                # 6. Category Pricing Rules
                if col == "Unit_Price":
                    desc = row.get("Line_Item_Description")
                    if desc and desc in category_rules:
                        rule = category_rules[desc]
                        p = parse_float(val)
                        if p is not None:
                            if rule["min_price"] is not None and p < rule["min_price"]:
                                anomalies.append(f"Price below limit ({rule['min_price']})")
                            if rule["max_price"] is not None and p > rule["max_price"]:
                                anomalies.append(f"Price exceeds limit ({rule['max_price']})")
            
            # Format the output value
            if anomalies:
                reason = ", ".join(anomalies)
                if is_missing:
                    highlighted_val = f"[ANOMALY: {reason}]"
                else:
                    highlighted_val = f"[ANOMALY: {reason}] {val_str}"
            else:
                highlighted_val = val_str
                
            highlighted_row.append(highlighted_val)
            
        writer.writerow(highlighted_row)
        
    return output.getvalue()

@app.post("/api/chat", response_model=ChatMessageResponse)
async def chat(request: ChatMessageRequest):
    msg_lower = request.message.lower()
    is_general_scan = any(kw in msg_lower for kw in ["initial", "scan", "perform", "all", "anomal"])
    
    if not is_general_scan:
        q_type = await determine_query_type(request.message)
        if q_type == "general_question":
            sql_query = await generate_sqlite_query(request.message)
            if sql_query:
                conn = get_db()
                try:
                    cursor = conn.cursor()
                    cursor.execute(sql_query)
                    rows = cursor.fetchall()
                    results = [dict(r) for r in rows]
                    conn.close()
                    
                    narration = await answer_question_with_results(request.message, results, sql_query)
                    return ChatMessageResponse(
                        response=narration,
                        anomaly_count=0
                    )
                except Exception as e:
                    print(f"Failed executing generated SQL: {e}")
                    try:
                        conn.close()
                    except Exception:
                        pass
    
    if is_general_scan:
        filters = {}
        categories = ["all"]
    else:
        validation_result = await validate_and_parse_query(request.message)
        if not validation_result.get("is_valid", False):
            return ChatMessageResponse(
                response=f"I couldn't process your request: {validation_result.get('reason', 'Invalid query or unrelated topic.')}",
                anomaly_count=0
            )
            
        filters = validation_result.get("filters", {})
        categories = filters.get("categories", ["all"])
        if not categories:
            categories = ["all"]
    
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
    
    if filters.get("Vendor_Name"):
        base_where += " AND Vendor_Name LIKE ?"
        base_params.append(f"%{filters['Vendor_Name']}%")
        
    if filters.get("min_amount") is not None:
        base_where += " AND CAST(Line_Amount AS REAL) >= ?"
        base_params.append(filters["min_amount"])
        
    if filters.get("max_amount") is not None:
        base_where += " AND CAST(Line_Amount AS REAL) <= ?"
        base_params.append(filters["max_amount"])
        
    if filters.get("start_date"):
        base_where += " AND Invoice_Date >= ?"
        base_params.append(filters["start_date"])
        
    if filters.get("end_date"):
        base_where += " AND Invoice_Date <= ?"
        base_params.append(filters["end_date"])
        
    if filters.get("Invoice_Status"):
        base_where += " AND Invoice_Status LIKE ?"
        base_params.append(f"%{filters['Invoice_Status']}%")
        
    # 1. Missing / Mismatch PO Numbers (Only in single audit mode)
    if request.context.audit_mode == "single" and request.context.expected_po_number:
        query = f"""SELECT Invoice_ID, Vendor_Name, PO_Number 
                    FROM invoices 
                    WHERE ({base_where}) 
                    GROUP BY source_file, Invoice_ID, Vendor_Name"""
        cursor.execute(query, base_params)
        for row in cursor.fetchall():
            po_num = str(row["PO_Number"]).strip() if row["PO_Number"] else ""
            if not po_num or po_num != str(request.context.expected_po_number).strip():
                anomalies.append({
                    "type": "PO Number Mismatch",
                    "Invoice_ID": row["Invoice_ID"],
                    "Vendor_Name": row["Vendor_Name"],
                    "description": f"Invoice PO Number '{po_num}' does not match expected PO '{request.context.expected_po_number}'."
                })
                
    # 1b. Date Mismatch (Only in single audit mode)
    if request.context.audit_mode == "single" and request.context.expected_invoice_date:
        query = f"""SELECT Invoice_ID, Vendor_Name, Invoice_Date 
                    FROM invoices 
                    WHERE ({base_where}) 
                    GROUP BY source_file, Invoice_ID, Vendor_Name"""
        cursor.execute(query, base_params)
        for row in cursor.fetchall():
            inv_date = str(row["Invoice_Date"]).strip() if row["Invoice_Date"] else ""
            if not inv_date or inv_date != str(request.context.expected_invoice_date).strip():
                anomalies.append({
                    "type": "Invoice Date Mismatch",
                    "Invoice_ID": row["Invoice_ID"],
                    "Vendor_Name": row["Vendor_Name"],
                    "description": f"Invoice Date '{inv_date}' does not match expected Date '{request.context.expected_invoice_date}'."
                })
            
    # 2. Unexpected Currency
    if False:
        query = f"""SELECT Invoice_ID, Vendor_Name, MAX(currency) as currency 
                    FROM invoices 
                    WHERE ({base_where}) AND 1=0 
                    GROUP BY source_file, Invoice_ID, Vendor_Name"""
        cursor.execute(query, base_params + [request.context.expected_currency])
        for row in cursor.fetchall():
            anomalies.append({
                "type": "Unexpected Currency",
                "Invoice_ID": row["Invoice_ID"],
                "Vendor_Name": row["Vendor_Name"],
                "currency": row["currency"]
            })
            
    # 3. Duplicate Invoices
    if ("all" in categories or "duplicate" in categories) and current_file:
        cursor.execute("SELECT DISTINCT Invoice_ID, Vendor_Name FROM invoices WHERE source_file = ?", (current_file,))
        current_props = cursor.fetchall()
        
        for prop in current_props:
            inv_id = prop["Invoice_ID"]
            vendor = prop["Vendor_Name"]
            
            if inv_id:
                cursor.execute("SELECT DISTINCT source_file FROM invoices WHERE Invoice_ID = ? AND source_file != ?", (inv_id, current_file))
                other_files = cursor.fetchall()
                if len(other_files) > 0:
                    anomalies.append({
                        "type": "Duplicate Invoice ID",
                        "Invoice_ID": inv_id,
                        "Vendor_Name": vendor,
                        "count": len(other_files) + 1
                    })
            else:
                cursor.execute("SELECT SUM(Line_Amount) FROM invoices WHERE source_file = ?", (current_file,))
                current_sum = cursor.fetchone()[0]
                
                if current_sum and vendor:
                    cursor.execute("""
                        SELECT source_file FROM invoices 
                        WHERE source_file != ? AND Vendor_Name = ?
                        GROUP BY source_file
                        HAVING SUM(Line_Amount) = ?
                    """, (current_file, vendor, current_sum))
                    other_files = cursor.fetchall()
                    if len(other_files) > 0:
                        anomalies.append({
                            "type": "Duplicate Invoice (Exact Match)",
                            "Invoice_ID": "Unknown",
                            "Vendor_Name": vendor,
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
            query = f"""SELECT Invoice_ID, Vendor_Name, MAX(Invoice_Date) as Invoice_Date 
                        FROM invoices 
                        WHERE ({base_where}) AND Invoice_Date IS NOT NULL 
                        GROUP BY source_file, Invoice_ID, Vendor_Name"""
            cursor.execute(query, base_params)
            for row in cursor.fetchall():
                try:
                    inv_date = datetime.strptime(row["Invoice_Date"], "%Y-%m-%d")
                    if (start_date and inv_date < start_date) or (end_date and inv_date > end_date):
                        anomalies.append({
                            "type": "Date Out of Range",
                            "Invoice_ID": row["Invoice_ID"],
                            "Vendor_Name": row["Vendor_Name"],
                            "Invoice_Date": row["Invoice_Date"]
                        })
                except ValueError:
                    anomalies.append({
                        "type": "Invalid Date Format",
                        "Invoice_ID": row["Invoice_ID"],
                        "Vendor_Name": row["Vendor_Name"],
                        "Invoice_Date": row["Invoice_Date"]
                    })

    # 5. Unexpected Payment Status (Removed)
    if False:
        pass

    query = f"SELECT * FROM invoices WHERE ({base_where})"
    cursor.execute(query, base_params)
    all_rows = cursor.fetchall()

    # 6. Missing Values Across All Columns
    if "all" in categories or "missing_value" in categories or "missing_data" in categories:
        seen_missing = set()
        for row in all_rows:
            inv_id = row["Invoice_ID"] or "Unknown"
            vendor = row["Vendor_Name"] or "Unknown"
            
            for col in [
                "Invoice_ID", "Invoice_Date", "Due_Date", "Vendor_Name", "Vendor_GSTIN",
                "PO_Number", "Payment_Terms", "Line_No", "Line_Item_Description", "Qty",
                "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping",
                "Grand_Total", "Bank_Account", "Invoice_Status"
            ]:
                # Respect PO number mismatch logic (PO missing values are audited in mismatch checks)
                if col == "PO_Number":
                    continue
                    
                val = row[col]
                if val is None or str(val).strip() == "":
                    key = (inv_id, vendor, col)
                    if key not in seen_missing:
                        seen_missing.add(key)
                        anomalies.append({
                            "type": "Missing Value",
                            "Invoice_ID": inv_id,
                            "Vendor_Name": vendor,
                            "column": col,
                            "description": f"Field '{format_field_name(col)}' is missing or null"
                        })

    # 7. Negative and Zero Values
    if "all" in categories or "negative_value" in categories or "zero_value" in categories:
        seen_negatives = set()
        for row in all_rows:
            inv_id = row["Invoice_ID"] or "Unknown"
            vendor = row["Vendor_Name"] or "Unknown"
            
            for col in ["Qty", "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", "Grand_Total"]:
                val = row[col]
                num_val = parse_float(val)
                if num_val is not None:
                    if num_val < 0:
                        key = (inv_id, vendor, col, num_val, "Negative Value")
                        if key not in seen_negatives:
                            seen_negatives.add(key)
                            anomalies.append({
                                "type": "Negative Value",
                                "Invoice_ID": inv_id,
                                "Vendor_Name": vendor,
                                "column": col,
                                "value": num_val,
                                "description": f"Field '{format_field_name(col)}' has a negative value ({num_val})"
                            })
                    elif num_val == 0 and col in ["Qty", "Unit_Price", "Line_Amount"]:
                        key = (inv_id, vendor, col, num_val, "Zero Value")
                        if key not in seen_negatives:
                            seen_negatives.add(key)
                            anomalies.append({
                                "type": "Zero Value",
                                "Invoice_ID": inv_id,
                                "Vendor_Name": vendor,
                                "column": col,
                                "value": num_val,
                                "description": f"Field '{format_field_name(col)}' has a value of zero (0)"
                            })

    # 8. Vendor Master List and Status Checks
    cursor.execute("SELECT Vendor_ID, Vendor_Name, GSTIN, Bank_Account, Payment_Terms, Status FROM vendors")
    master_vendors = {r["Vendor_Name"]: dict(r) for r in cursor.fetchall()}
    
    cursor.execute("SELECT * FROM category_rules")
    category_rules = {r["category_name"]: dict(r) for r in cursor.fetchall()}
    
    seen_vendor_master_anomalies = set()
    for row in all_rows:
        inv_id = row["Invoice_ID"] or "Unknown"
        v_name = row["Vendor_Name"]
        inv_gstin = row["Vendor_GSTIN"]
        inv_bank = row["Bank_Account"]
        inv_terms = row["Payment_Terms"]
        
        if not v_name or v_name.strip() == "":
            continue
            
        # 8a. Unknown Vendor Check
        if v_name not in master_vendors:
            anomaly_key = (inv_id, v_name, "Unknown Vendor")
            if anomaly_key not in seen_vendor_master_anomalies:
                seen_vendor_master_anomalies.add(anomaly_key)
                anomalies.append({
                    "type": "Unknown Vendor",
                    "Invoice_ID": inv_id,
                    "Vendor_Name": v_name,
                    "description": f"Vendor '{v_name}' is not registered in the vendor master list."
                })
            continue
            
        master = master_vendors[v_name]
        
        # 8b. Blocked Vendor Check
        if master["Status"].strip().title() == "Blocked":
            anomaly_key = (inv_id, v_name, "Blocked Vendor")
            if anomaly_key not in seen_vendor_master_anomalies:
                seen_vendor_master_anomalies.add(anomaly_key)
                anomalies.append({
                    "type": "Vendor Status Warning",
                    "Invoice_ID": inv_id,
                    "Vendor_Name": v_name,
                    "description": f"Vendor '{v_name}' currently has a suspended/blocked status in our system."
                })
                
        # 8c. GSTIN Mismatch Check
        if inv_gstin and master["GSTIN"] and str(inv_gstin).strip() != str(master["GSTIN"]).strip():
            anomaly_key = (inv_id, v_name, "GSTIN Mismatch")
            if anomaly_key not in seen_vendor_master_anomalies:
                seen_vendor_master_anomalies.add(anomaly_key)
                anomalies.append({
                    "type": "GSTIN Mismatch",
                    "Invoice_ID": inv_id,
                    "Vendor_Name": v_name,
                    "description": f"Invoice GSTIN '{inv_gstin}' does not match registered GSTIN '{master['GSTIN']}'."
                })
                
        # 8d. Bank Account Mismatch Check
        if inv_bank and master["Bank_Account"] and str(inv_bank).strip() != str(master["Bank_Account"]).strip():
            anomaly_key = (inv_id, v_name, "Bank Account Mismatch")
            if anomaly_key not in seen_vendor_master_anomalies:
                seen_vendor_master_anomalies.add(anomaly_key)
                anomalies.append({
                    "type": "Bank Account Mismatch",
                    "Invoice_ID": inv_id,
                    "Vendor_Name": v_name,
                    "description": f"Invoice Bank Account '{inv_bank}' does not match registered Bank Account '{master['Bank_Account']}'."
                })
                
        # 8e. Payment Terms Mismatch Check
        if inv_terms and master["Payment_Terms"] and str(inv_terms).strip() != str(master["Payment_Terms"]).strip():
            anomaly_key = (inv_id, v_name, "Payment Terms Mismatch")
            if anomaly_key not in seen_vendor_master_anomalies:
                seen_vendor_master_anomalies.add(anomaly_key)
                anomalies.append({
                    "type": "Payment Terms Mismatch",
                    "Invoice_ID": inv_id,
                    "Vendor_Name": v_name,
                    "description": f"Invoice Payment Terms '{inv_terms}' does not match registered Payment Terms '{master['Payment_Terms']}'."
                })
                
        desc = row["Line_Item_Description"]
        if desc and desc in category_rules:
            rule = category_rules[desc]
            price = row["Unit_Price"]
            if price is not None:
                try:
                    p = float(price)
                    if rule["min_price"] is not None and p < rule["min_price"]:
                        anomalies.append({
                            "type": "Pricing Anomaly",
                            "Invoice_ID": inv_id,
                            "Vendor_Name": vendor,
                            "description": f"Unit price for '{desc}' (${p}) is below Admin limit (${rule['min_price']})."
                        })
                    if rule["max_price"] is not None and p > rule["max_price"]:
                        anomalies.append({
                            "type": "Pricing Anomaly",
                            "Invoice_ID": inv_id,
                            "Vendor_Name": vendor,
                            "description": f"Unit price for '{desc}' (${p}) exceeds Admin limit (${rule['max_price']})."
                        })
                except (ValueError, TypeError):
                    pass

    highlighted_csv = None
    if current_file:
        highlighted_csv = generate_highlighted_csv(current_file, request.context, conn)

    conn.close()
    
    if not anomalies:
        return ChatMessageResponse(
            response="I analyzed the database based on your criteria, and no anomalies were found.",
            anomaly_count=0,
            highlighted_csv=highlighted_csv
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
        "Invoice_Status": "",
        "missing_data": "",
        "negative_value": "",
        "rbac_rule": ""
    })
    
    for a in filtered_anomalies:
        inv_id = a.get("Invoice_ID") or "UNKNOWN_ID"
        record = invoice_data[inv_id]
        
        # Capture the actual vendor name if we don't have one yet
        if a.get("Vendor_Name") and a.get("Vendor_Name") != "None" and record["vendor"] == "Unknown":
            record["vendor"] = a.get("Vendor_Name")
            
        t = a.get("type")
        if t == "Duplicate Invoice ID":
            record["duplicate"] = f"Duplicate ({a.get('count')} occurrences)"
        elif t in ["Date Out of Range", "Invalid Date Format"]:
            date_val = a.get("Invoice_Date") or "Missing"
            existing = record["date"]
            if not existing:
                record["date"] = f"Out of range ({date_val})"
            elif date_val not in existing:
                record["date"] = existing.rstrip(")") + f"; {date_val})"
        elif t in ["Amount Out of Range", "Invalid Amount Format"]:
            amt_val = str(a.get("Line_Amount") or "Missing")
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
        elif t in ["Missing PO Number", "PO Number Mismatch"]:
            record["po"] = a.get("description") or "Missing / Mismatch PO"
        elif t == "Invoice Date Mismatch":
            record["date"] = a.get("description") or "Date Mismatch"
        elif t == "Unexpected Payment Status":
            status_val = a.get("Invoice_Status") or "Missing"
            existing = record["Invoice_Status"]
            if not existing:
                record["Invoice_Status"] = status_val
            elif status_val not in existing:
                record["Invoice_Status"] = existing + f"; {status_val}"
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
        "Invoice ID,Vendor Name,Anomaly Type,Description"
    ]
    for a in filtered_anomalies:
        inv_id = str(a.get("Invoice_ID") or "Unknown").replace('"', '""')
        vendor = str(a.get("Vendor_Name") or "Unknown").replace('"', '""')
        anomaly_type = str(a.get("type") or "Unknown").replace('"', '""')
        # Clean type to remove underscores
        anomaly_type = format_field_name(anomaly_type)
        desc = str(a.get("description") or "").replace('"', '""')
        
        raw_csv_lines.append(
            f'"{inv_id}","{vendor}","{anomaly_type}","{desc}"'
        )
        
    return ChatMessageResponse(
        response=narration,
        anomaly_count=len(filtered_anomalies),
        raw_csv="\n".join(raw_csv_lines),
        highlighted_csv=highlighted_csv
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8081, reload=True)
