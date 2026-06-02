from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime, Text
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
    google_sheet_url = Column(String, nullable=True)
    spreadsheet_id = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    connection_type = Column(String, default="google_sheets")
    file_path = Column(String, nullable=True)
    
    owner = relationship("User", back_populates="connections")
    projects = relationship("Project", foreign_keys="[Project.connection_id]", back_populates="connection")

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))
    connection_id = Column(Integer, ForeignKey("connections.id"))
    master_connection_id = Column(Integer, ForeignKey("connections.id"), nullable=True)
    master_sheet_name = Column(String, nullable=True)
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
    """Plantilla de salida: define qué columnas de la Tabla Master se exportan y con qué nombre."""
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


