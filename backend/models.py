from pydantic import BaseModel, EmailStr
from typing import List, Optional, Any

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class UserResponse(BaseModel):
    id: int
    email: str
    role: str

class VendorStatusUpdate(BaseModel):
    status: str # "active" or "blocked"

class CategoryRuleCreate(BaseModel):
    category_name: str
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    expected_tax_rate: Optional[float] = None

class ColumnMappingRequest(BaseModel):
    raw_columns: List[str]

class MappedColumn(BaseModel):
    raw_column: str
    standard_field: Optional[str]
    confidence: str # "high", "medium", "low", "unmapped"

class ColumnMappingResponse(BaseModel):
    mappings: List[MappedColumn]

class InvoiceDataRow(BaseModel):
    source_file: str
    data: dict # dict of standard_field -> value

class ConfirmMappingRequest(BaseModel):
    rows: List[InvoiceDataRow]

class OnboardingContext(BaseModel):
    audit_mode: str = "batch" # "batch" or "single"
    expected_start_date: Optional[str] = None
    expected_end_date: Optional[str] = None
    expected_po_number: Optional[str] = None
    expected_invoice_date: Optional[str] = None

class ChatMessageRequest(BaseModel):
    message: str
    context: OnboardingContext
    history: List[dict] # {role: 'user'|'model', content: str}

class ChatMessageResponse(BaseModel):
    response: str
    anomaly_count: int
    raw_csv: Optional[str] = None
    highlighted_csv: Optional[str] = None

class QueryFilters(BaseModel):
    categories: List[str]
    vendor_name: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    payment_status: Optional[str] = None

class ValidatedQuery(BaseModel):
    is_valid: bool
    reason: Optional[str] = None
    filters: Optional[QueryFilters] = None

class VendorCreate(BaseModel):
    Vendor_ID: str
    Vendor_Name: str
    GSTIN: Optional[str] = ""
    Bank_Account: Optional[str] = ""
    Payment_Terms: Optional[str] = ""
    Status: Optional[str] = "Active"
