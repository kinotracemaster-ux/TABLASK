from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

# Users
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

# Connections
class ConnectionBase(BaseModel):
    name: str
    connection_type: str = "google_sheets"
    google_sheet_url: Optional[str] = None
    file_path: Optional[str] = None
    http_url: Optional[str] = None
    http_method: str = "GET"
    http_headers: Optional[str] = None

class ConnectionCreate(ConnectionBase):
    pass

class Connection(ConnectionBase):
    id: int
    spreadsheet_id: Optional[str] = None
    user_id: Optional[int] = None
    
    class Config:
        from_attributes = True

# Projects
class ProjectBase(BaseModel):
    name: str
    connection_id: Optional[int] = None
    master_connection_id: Optional[int] = None
    master_sheet_name: Optional[str] = None

class ProjectCreate(ProjectBase):
    pass

class Project(ProjectBase):
    id: int
    user_id: Optional[int] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

# Tables & Mappings
class FieldMappingBase(BaseModel):
    source_field: str
    target_field: str
    is_key: bool

class FieldMappingCreate(FieldMappingBase):
    source_table_id: int
    target_table_id: int

class FieldMapping(FieldMappingBase):
    id: int
    project_id: int
    
    class Config:
        from_attributes = True

# Sync Rules
class SyncRuleBase(BaseModel):
    rule_type: str

class SyncRuleCreate(SyncRuleBase):
    pass

class SyncRule(SyncRuleBase):
    id: int
    project_id: int
    
    class Config:
        from_attributes = True

# Sync Logs
class SyncLogBase(BaseModel):
    rows_changed: int = 0
    rows_added: int = 0
    errors: int = 0
    status: str

class SyncLogCreate(SyncLogBase):
    pass

class SyncLog(SyncLogBase):
    id: int
    project_id: int
    executed_at: datetime
    
    class Config:
        from_attributes = True

# Export Formats
from typing import Dict, Any

# [DEPRECADO] Usar FieldSubscription
class ExportFormatBase(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: int
    source_connection_id: int
    source_sheet_name: str
    columns_mapping: Dict[str, str]
    output_type: str = "csv_download"
    output_spreadsheet_id: Optional[str] = None
    output_sheet_name: Optional[str] = None

class ExportFormatCreate(ExportFormatBase):
    pass

class ExportFormat(ExportFormatBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Suscripciones de Campos (Destinos Inteligentes)
class FieldSubscriptionBase(BaseModel):
    project_id: int
    target_connection_id: int
    target_sheet_name: str
    sku_column_target: str
    field_mappings: Dict[str, str]  # {"columna_maestra": "columna_hija"}
    is_active: bool = True
    name: str

class FieldSubscriptionCreate(FieldSubscriptionBase):
    pass

class FieldSubscriptionBulkCreate(BaseModel):
    """Crea la misma suscripción (mismo mapeo y llave) para varias hojas hijas a la vez."""
    project_id: int
    target_connection_id: int
    target_sheets: List[str]              # Pestañas destino que comparten estructura
    sku_column_target: str
    field_mappings: Dict[str, str]
    is_active: bool = True
    name_prefix: str = "Suscripción"

class FieldSubscription(FieldSubscriptionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Master Table (Google Sheets backed)
class MasterSyncRequest(BaseModel):
    source_connection_id: int
    source_sheet_name: str
    target_connection_id: Optional[int] = None
    target_sheet_name: Optional[str] = None
    sku_column_source: str
    sku_column_master: str
    field_mappings: Dict[str, str]  # {"columna_origen": "columna_maestra"}
    add_new_rows: bool = True

class MasterLinkRequest(BaseModel):
    master_connection_id: int
    master_sheet_name: str


# Processes (Importación)
class ProcessBase(BaseModel):
    name: str
    description: Optional[str] = None
    source_connection_id: int
    source_sheet_name: str
    target_connection_id: Optional[int] = None
    target_sheet_name: Optional[str] = None
    sku_column_source: str
    sku_column_master: str
    field_mappings: Dict[str, str]  # {"col_origen": "col_destino"}
    add_new_rows: bool = True
    is_active: bool = True

class ProcessCreate(ProcessBase):
    pass

class Process(ProcessBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# Execution Logs
class ExecutionLogBase(BaseModel):
    process_id: Optional[int] = None
    batch_id: Optional[str] = None
    event_type: str
    status: str
    message: str
    technical_detail: Optional[str] = None
    rows_affected: int = 0
    duration_ms: int = 0

class ExecutionLogCreate(ExecutionLogBase):
    pass

class ExecutionLog(ExecutionLogBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# Staging
class StagingBatchBase(BaseModel):
    process_id: Optional[int] = None
    status: str = "pending"
    diff_result: str

class StagingBatchCreate(StagingBatchBase):
    raw_data: Optional[str] = None
    normalized_data: str

class StagingBatch(StagingBatchBase):
    id: int
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# Connected Apps (Intake API)
class ConnectedAppBase(BaseModel):
    name: str
    target_project_id: Optional[int] = None
    is_active: bool = True

class ConnectedAppCreate(ConnectedAppBase):
    pass

class ConnectedApp(ConnectedAppBase):
    id: int
    api_key: str
    created_at: datetime
    
    class Config:
        from_attributes = True
