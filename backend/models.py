from pydantic import BaseModel
from typing import List, Optional, Any

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
    expected_date_range: str
    expected_currency: str
    expected_total_amount_range: str
    po_numbers_required: bool
    expected_payment_status: str

class ChatMessageRequest(BaseModel):
    message: str
    context: OnboardingContext
    history: List[dict] # {role: 'user'|'model', content: str}

class ChatMessageResponse(BaseModel):
    response: str
    anomaly_count: int
    raw_csv: Optional[str] = None
