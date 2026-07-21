import sqlite3
import random
from datetime import datetime, timedelta

db_path = 'backend/invoices.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all invoice IDs
cursor.execute("SELECT id FROM invoices")
rows = cursor.fetchall()

# Generate random dates for the last 14 days
base_date = datetime.now()

for row in rows:
    invoice_id = row[0]
    # Random days ago (between 0 and 14)
    days_ago = random.randint(0, 14)
    # Random hour, minute, second
    hours = random.randint(0, 23)
    minutes = random.randint(0, 59)
    seconds = random.randint(0, 59)
    
    random_date = base_date - timedelta(days=days_ago, hours=hours, minutes=minutes, seconds=seconds)
    formatted_date = random_date.strftime('%Y-%m-%d %H:%M:%S')
    
    cursor.execute("UPDATE invoices SET upload_timestamp = ? WHERE id = ?", (formatted_date, invoice_id))

conn.commit()
conn.close()

print("Successfully updated invoice dates.")
