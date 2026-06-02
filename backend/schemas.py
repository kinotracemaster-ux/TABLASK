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
    google_sheet_url: Optional[str] = None
    connection_type: str = "google_sheets"
    file_path: Optional[str] = None

class ConnectionCreate(ConnectionBase):
    pass

class Connection(ConnectionBase):
    id: int
    spreadsheet_id: Optional[str] = None
    user_id: int
    
    class Config:
        from_attributes = True

# Projects
class ProjectBase(BaseModel):
    name: str
    connection_id: int
    master_connection_id: Optional[int] = None
    master_sheet_name: Optional[str] = None

class ProjectCreate(ProjectBase):
    pass

class Project(ProjectBase):
    id: int
    user_id: int
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


# Master Table (Google Sheets backed)
class MasterSyncRequest(BaseModel):
    source_connection_id: int
    source_sheet_name: str
    sku_column_source: str
    sku_column_master: str
    field_mappings: Dict[str, str]  # {"columna_origen": "columna_maestra"}
    add_new_rows: bool = True

class MasterLinkRequest(BaseModel):
    master_connection_id: int
    master_sheet_name: str
