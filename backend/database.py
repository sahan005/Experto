import sqlite3
import os
from dotenv import load_dotenv, find_dotenv
import bcrypt

load_dotenv(find_dotenv())

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
        Invoice_ID TEXT,
        Invoice_Date TEXT,
        Due_Date TEXT,
        Vendor_Name TEXT,
        Vendor_GSTIN TEXT,
        PO_Number TEXT,
        Payment_Terms TEXT,
        Line_No TEXT,
        Line_Item_Description TEXT,
        Qty REAL,
        Unit_Price REAL,
        Line_Amount REAL,
        Subtotal REAL,
        Discount REAL,
        Tax REAL,
        Shipping REAL,
        Grand_Total REAL,
        Bank_Account TEXT,
        Invoice_Status TEXT,
        source_file TEXT,
        upload_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Table 3: users
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
    )
    """)

    # Table 4: vendors
    cursor.execute("DROP TABLE IF EXISTS vendors")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS vendors (
        Vendor_ID TEXT PRIMARY KEY,
        Vendor_Name TEXT UNIQUE NOT NULL,
        GSTIN TEXT,
        Bank_Account TEXT,
        Payment_Terms TEXT,
        Status TEXT NOT NULL DEFAULT 'Active'
    )
    """)

    # Seed vendors
    vendors_seeds = [
        ("V001", "ABC Technologies Pvt Ltd", "19ABCDE1234F1Z5", "50200012345678", "Net 30", "Active"),
        ("V002", "TechNova Solutions Pvt Ltd", "29AAACT5678L1Z2", "60210045678912", "Net 45", "Active"),
        ("V003", "CloudSphere Software Pvt Ltd", "27AACCS9876R1Z4", "70220099887766", "Net 30", "Active")
    ]
    for v_id, v_name, gstin, bank, terms, status in vendors_seeds:
        cursor.execute("""
            INSERT OR REPLACE INTO vendors (Vendor_ID, Vendor_Name, GSTIN, Bank_Account, Payment_Terms, Status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (v_id, v_name, gstin, bank, terms, status))

    # Table 5: category_rules
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS category_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_name TEXT UNIQUE NOT NULL,
        min_price REAL,
        max_price REAL,
        expected_tax_rate REAL
    )
    """)
    
    # Seed canonical invoice field names into standard_schema
    canonical_fields = [
        "Invoice_ID", "Invoice_Date", "Due_Date", "Vendor_Name", "Vendor_GSTIN", 
        "PO_Number", "Payment_Terms", "Line_No", "Line_Item_Description", "Qty", 
        "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", 
        "Grand_Total", "Bank_Account", "Invoice_Status"
    ]
    
    for field in canonical_fields:
        cursor.execute("INSERT OR IGNORE INTO standard_schema (field_name) VALUES (?)", (field,))

    # Seed Admin User
    cursor.execute("SELECT * FROM users WHERE email = 'admin@experto.ai'")
    admin_exists = cursor.fetchone()
    if not admin_exists:
        hashed_password = bcrypt.hashpw("admin123".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor.execute("INSERT INTO users (email, hashed_password, role) VALUES (?, ?, ?)", 
                       ("admin@experto.ai", hashed_password, "admin"))
        
    conn.commit()
    conn.close()
