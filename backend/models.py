from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime, Text, func
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    connections = relationship("Connection", back_populates="owner")
    projects = relationship("Project", back_populates="owner")

class Connection(Base):
    __tablename__ = "connections"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # Campos para Google Sheets
    google_sheet_url = Column(String, nullable=True)
    spreadsheet_id = Column(String, nullable=True)
    
    # Campos para Archivos Locales
    file_path = Column(String, nullable=True)
    
    # Campos para HTTP API
    http_url = Column(String, nullable=True)
    http_method = Column(String, default="GET")
    http_headers = Column(Text, nullable=True) # JSON stringificado

    # Campos para Shopify (client_credentials grant, una conexión por tienda)
    shopify_domain = Column(String, nullable=True)        # mi-tienda.myshopify.com
    shopify_client_id = Column(String, nullable=True)
    shopify_client_secret = Column(String, nullable=True) # Sensible: idealmente cifrar/rotar
    shopify_api_version = Column(String, nullable=True)   # Ej: 2026-04 (nulo => default)

    user_id = Column(Integer, ForeignKey("users.id"))
    connection_type = Column(String, default="google_sheets")
    
    owner = relationship("User", back_populates="connections")
    projects = relationship("Project", foreign_keys="[Project.connection_id]", back_populates="connection")

    @property
    def has_shopify_secret(self) -> bool:
        return bool(self.shopify_client_secret)

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))
    connection_id = Column(Integer, ForeignKey("connections.id"))
    master_connection_id = Column(Integer, ForeignKey("connections.id"), nullable=True)
    master_sheet_name = Column(String, nullable=True)
    master_sku_column = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    owner = relationship("User", back_populates="projects")
    connection = relationship("Connection", foreign_keys=[connection_id], back_populates="projects")
    master_connection = relationship("Connection", foreign_keys=[master_connection_id])
    mappings = relationship("FieldMapping", back_populates="project", cascade="all, delete-orphan")
    source_tables = relationship("SourceTable", back_populates="project", cascade="all, delete-orphan")
    target_tables = relationship("TargetTable", back_populates="project", cascade="all, delete-orphan")
    sync_rules = relationship("SyncRule", back_populates="project", cascade="all, delete-orphan")
    sync_logs = relationship("SyncLog", back_populates="project", cascade="all, delete-orphan")
    export_formats = relationship("ExportFormat", back_populates="project", cascade="all, delete-orphan")
    field_subscriptions = relationship("FieldSubscription", back_populates="project", cascade="all, delete-orphan")

class SourceTable(Base):
    __tablename__ = "source_tables"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    sheet_name = Column(String, nullable=False)
    
    project = relationship("Project", back_populates="source_tables")
    mappings = relationship("FieldMapping", back_populates="source_table")

class TargetTable(Base):
    __tablename__ = "target_tables"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    sheet_name = Column(String, nullable=False)
    
    project = relationship("Project", back_populates="target_tables")
    mappings = relationship("FieldMapping", back_populates="target_table")

class FieldMapping(Base):
    __tablename__ = "field_mappings"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    source_table_id = Column(Integer, ForeignKey("source_tables.id"))
    source_field = Column(String, nullable=False)
    target_table_id = Column(Integer, ForeignKey("target_tables.id"))
    target_field = Column(String, nullable=False)
    is_key = Column(Boolean, default=False)
    
    project = relationship("Project", back_populates="mappings")
    source_table = relationship("SourceTable", back_populates="mappings")
    target_table = relationship("TargetTable", back_populates="mappings")

class SyncRule(Base):
    __tablename__ = "sync_rules"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    rule_type = Column(String, nullable=False) # e.g. 'update_always', 'only_if_empty'
    
    project = relationship("Project", back_populates="sync_rules")

class SyncLog(Base):
    __tablename__ = "sync_logs"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    executed_at = Column(DateTime, default=datetime.utcnow)
    rows_changed = Column(Integer, default=0)
    rows_added = Column(Integer, default=0)
    errors = Column(Integer, default=0)
    status = Column(String, nullable=False) # 'success', 'error'
    
    project = relationship("Project", back_populates="sync_logs")

class ExportFormat(Base):
    """[DEPRECADO] Usar FieldSubscription. Plantilla de salida: define qué columnas de la Tabla Master se exportan y con qué nombre."""
    __tablename__ = "export_formats"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)              # Ej: "Página Web", "Visor", "Effi Inventario"
    description = Column(String, nullable=True)         # Descripción opcional
    project_id = Column(Integer, ForeignKey("projects.id"))
    source_connection_id = Column(Integer, ForeignKey("connections.id"))  # La Tabla Master
    source_sheet_name = Column(String, nullable=False)  # Hoja dentro de la Master
    # JSON string: {"Nombre_Final": "title", "Stock": "inventory_count"}
    columns_mapping = Column(Text, nullable=False)
    # Tipo de salida: 'csv_download' o 'google_sheets'
    output_type = Column(String, default="csv_download")
    # Si output_type == 'google_sheets': sheet destino donde se escriben los datos
    output_spreadsheet_id = Column(String, nullable=True)
    output_sheet_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="export_formats")
    source_connection = relationship("Connection")


class FieldSubscription(Base):
    """Contrato entre la Maestra y una hoja hija para recibir actualizaciones de campos específicos."""
    __tablename__ = "field_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    target_connection_id = Column(Integer, ForeignKey("connections.id"))
    target_sheet_name = Column(String, nullable=False)
    sku_column_target = Column(String, nullable=False)  # Nombre de la llave en la hija
    
    # JSON: {"columna_maestra": "columna_hija"}
    field_mappings = Column(Text, nullable=False)
    
    is_active = Column(Boolean, default=True)
    name = Column(String, nullable=False)  # Ej: "Catálogo Shopify"
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="field_subscriptions")
    target_connection = relationship("Connection")


class Process(Base):
    """Proceso de importación: trae datos de una fuente externa hacia la Tabla Maestra."""
    __tablename__ = "processes"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)              # "Actualizar Inventario"
    description = Column(String, nullable=True)        # "Trae stock del proveedor X"
    source_connection_id = Column(Integer, ForeignKey("connections.id"))
    source_sheet_name = Column(String, nullable=False)  # Hoja en el origen
    
    # Destino explícito (Si es nulo, usa la Maestra global)
    target_connection_id = Column(Integer, ForeignKey("connections.id"), nullable=True)
    target_sheet_name = Column(String, nullable=True)

    sku_column_source = Column(String, nullable=False)  # Nombre de col SKU en origen
    sku_column_master = Column(String, nullable=False)  # Nombre de col SKU en destino
    field_mappings = Column(Text, nullable=False)       # JSON: {"col_origen": "col_destino"}
    add_new_rows = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    source_connection = relationship("Connection", foreign_keys=[source_connection_id])
    target_connection = relationship("Connection", foreign_keys=[target_connection_id])

class ExecutionLog(Base):
    """Registro detallado de ejecuciones y errores del sistema."""
    __tablename__ = "execution_logs"
    id = Column(Integer, primary_key=True, index=True)
    process_id = Column(Integer, ForeignKey("processes.id"), nullable=True) # Opcional, puede ser un log del sistema
    batch_id = Column(String, nullable=True) # Para cuando implementemos Staging
    event_type = Column(String, nullable=False) # e.g. 'FETCH_START', 'NORMALIZE_ERROR', 'WRITE_ERROR'
    status = Column(String, nullable=False) # 'success', 'error', 'warning', 'info'
    message = Column(String, nullable=False) # Mensaje legible para el usuario
    technical_detail = Column(Text, nullable=True) # Traceback o JSON raw
    rows_affected = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    process = relationship("Process")

class StagingBatch(Base):
    """Lote de datos en cuarentena esperando revisión antes de escribirse en la Tabla Maestra."""
    __tablename__ = "staging_batches"
    id = Column(Integer, primary_key=True, index=True)
    process_id = Column(Integer, ForeignKey("processes.id"))
    status = Column(String, default="pending") # 'pending', 'approved', 'rejected', 'expired'
    raw_data = Column(Text, nullable=True) # JSON con los datos originales (opcional)
    normalized_data = Column(Text, nullable=False) # JSON con el formato lista de listas interno
    diff_result = Column(Text, nullable=False) # JSON con el resumen (filas_nuevas, filas_actualizadas, etc)
    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=True)

    process = relationship("Process")


class ConnectedApp(Base):
    """
    Representa una aplicación externa (ej. Shopify) que tiene permiso
    para inyectar datos directamente al sistema vía webhooks/APIs.
    """
    __tablename__ = "connected_apps"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)  # Ej: "Shopify Store 1"
    api_key = Column(String, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)
    
    # Mapeo por defecto o proyecto asociado (opcional, para ingesta directa a la maestra)
    target_project_id = Column(Integer, nullable=True)


class MasterSnapshot(Base):
    """
    Última 'foto' conocida de la Tabla Maestra para un proyecto.
    Permite detectar ediciones manuales hechas directamente en Google Sheets
    y propagarlas (reflejo) a las hojas hijas suscritas.
    """
    __tablename__ = "master_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), unique=True, index=True)
    sku_column = Column(String, nullable=False)        # Columna llave usada en la maestra
    # JSON: {"SKU123": {"columna": "valor", ...}, ...}
    snapshot_data = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)
