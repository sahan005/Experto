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
        INSERT INTO invoices (invoice_id, vendor_name, total_amount, currency, source_file, upload_timestamp)
        VALUES ('TEST-DUP-1', 'Test Vendor', 500, 'USD', 'file1.csv', '2026-06-24 22:00:00')
    """)
    
    # 2. Current Invoice upload with anomalies:
    # - Negative value for quantity and total_amount
    # - Missing values (vendor_id is null, due_date is null, approver_name is null)
    # - Also triggers duplicate with TEST-DUP-1
    cursor.execute("""
        INSERT INTO invoices (
            invoice_id, vendor_name, vendor_id, invoice_date, due_date,
            line_item_description, quantity, unit_price, total_amount,
            currency, purchase_order_number, payment_status, source_file, upload_timestamp
        )
        VALUES (
            'TEST-DUP-1', 'Test Vendor', NULL, '2023-06-15', NULL,
            'Damaged Widget', -5.0, 30.0, -150.0,
            'USD', 'PO-9999', 'Unpaid', 'file2.csv', '2026-06-24 22:05:00'
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
        print("CSV Output:\n", response.raw_csv)
        print("Highlighted CSV Output:\n", response.highlighted_csv)
    except Exception as e:
        print("\nERROR in scan:")
        print(e)

if __name__ == "__main__":
    asyncio.run(test_pipeline())
