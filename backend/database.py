import sqlite3
import os
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.environ.get("DB_PATH", "invoices.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Table 1: standard_schema
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS standard_schema (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_name TEXT UNIQUE NOT NULL
    )
    """)

    # Table 2: invoices
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT,
        vendor_name TEXT,
        vendor_id TEXT,
        invoice_date TEXT,
        due_date TEXT,
        line_item_description TEXT,
        quantity REAL,
        unit_price REAL,
        total_amount REAL,
        currency TEXT,
        tax_amount REAL,
        discount REAL,
        purchase_order_number TEXT,
        payment_status TEXT,
        department TEXT,
        approver_name TEXT,
        source_file TEXT,
        upload_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # Seed canonical invoice field names into standard_schema
    canonical_fields = [
        "invoice_id", "vendor_name", "vendor_id", "invoice_date", "due_date",
        "line_item_description", "quantity", "unit_price", "total_amount",
        "currency", "tax_amount", "discount", "purchase_order_number",
        "payment_status", "department", "approver_name"
    ]
    
    for field in canonical_fields:
        cursor.execute("INSERT OR IGNORE INTO standard_schema (field_name) VALUES (?)", (field,))
        
    conn.commit()
    conn.close()
