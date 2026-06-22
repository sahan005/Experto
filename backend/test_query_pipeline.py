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
    
    # Simulate uploads: insert test records with the exact same invoice_id across two files
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM invoices") # reset for clean test
    # Older upload
    cursor.execute("""
        INSERT INTO invoices (invoice_id, vendor_name, total_amount, currency, source_file)
        VALUES ('TEST-DUP-1', 'Test Vendor', 500, 'USD', 'file1.csv')
    """)
    # Most recent upload (Current Invoice)
    cursor.execute("""
        INSERT INTO invoices (invoice_id, vendor_name, total_amount, currency, source_file)
        VALUES ('TEST-DUP-1', 'Test Vendor', 500, 'USD', 'file2.csv')
    """)
    conn.commit()
    conn.close()
    
    request = ChatMessageRequest(
        message="Are there any duplicate invoices?",
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
        response = await chat(request)
        print("\nSUCCESS! Received response:")
        print("Anomaly Count:", response.anomaly_count)
        print("Narration:", response.response)
    except Exception as e:
        print("\nERROR:")
        print(e)

if __name__ == "__main__":
    asyncio.run(test_pipeline())
