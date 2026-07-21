import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from models import ChatMessageRequest, OnboardingContext
from main import chat
from database import init_db, get_db

async def test_pipeline():
    print("Testing the query pipeline...")
    init_db()
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM invoices") # reset for clean test
    
    # 1. Duplicate Scenario
    cursor.execute("""
        INSERT INTO invoices (Invoice_ID, Vendor_Name, Line_Amount, source_file, upload_timestamp)
        VALUES ('TEST-DUP-1', 'Test Vendor', 500, 'file1.csv', '2026-06-24 22:00:00')
    """)
    
    # 2. Current Invoice upload with anomalies:
    # - Negative value for quantity and Line_Amount
    # - Missing values
    # - Also triggers duplicate with TEST-DUP-1
    cursor.execute("""
        INSERT INTO invoices (
            Invoice_ID, Vendor_Name, Vendor_GSTIN, Invoice_Date, Due_Date,
            Line_Item_Description, Qty, Unit_Price, Line_Amount,
            PO_Number, Payment_Terms, source_file, upload_timestamp
        )
        VALUES (
            'TEST-DUP-1', 'Test Vendor', NULL, '2023-06-15', NULL,
            'Damaged Widget', -5.0, 30.0, -150.0,
            'PO-9999', 'Unpaid', 'file2.csv', '2026-06-24 22:05:00'
        )
    """)
    conn.commit()
    conn.close()
    
    # Query 1: Ask about all anomalies
    request_all = ChatMessageRequest(
        message="Please analyze the latest upload and report all anomalies.",
        context=OnboardingContext(
            expected_start_date="2023-01-01",
            expected_end_date="2023-12-31",
            expected_currency="USD",
            po_numbers_required=True,
            expected_payment_status="Unpaid"
        ),
        history=[]
    )
    
    try:
        response = await chat(request_all)
        print("\n=== SCAN FOR ALL ANOMALIES ===")
        print("Anomaly Count:", response.anomaly_count)
        print("Narration:", response.response)
    except Exception as e:
        print("\nERROR in scan:", e)

if __name__ == "__main__":
    asyncio.run(test_pipeline())
