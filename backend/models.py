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
    shopify_access_token = Column(String, nullable=True)  # Token directo shpat_ (custom app); sensible
    shopify_api_version = Column(String, nullable=True)   # Ej: 2026-04 (nulo => default)

    user_id = Column(Integer, ForeignKey("users.id"))
    connection_type = Column(String, default="google_sheets")
    
    owner = relationship("User", back_populates="connections")
    projects = relationship("Project", foreign_keys="[Project.connection_id]", back_populates="connection")

    @property
    def has_shopify_secret(self) -> bool:
        return bool(self.shopify_client_secret) or bool(self.shopify_access_token)

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
    export_formats = relationship("ExportFormat", back_populates="project", cascade="all, delete-orphan")
    field_subscriptions = relationship("FieldSubscription", back_populates="project", cascade="all, delete-orphan")

# NOTA: SourceTable, TargetTable, FieldMapping, SyncRule y SyncLog (arquitectura
# vieja per-proyecto) se retiraron en jul 2026: no tenían ningún uso en el flujo
# real Base→Master→Distribución. Sus tablas quedan huérfanas en Postgres pero no
# estorban (no se crean nuevas en SQLite nuevo). Ver MEMORIA_PROYECTO §6.

class ExportFormat(Base):
    """Plantilla de salida a CSV: define las columnas de salida y cómo se generan
    desde la Maestra (renombrado directo en columns_mapping, o transformaciones en
    transform_spec — ver export_engine/export_presets, §11). Es un Destino más."""
    __tablename__ = "export_formats"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)              # Ej: "Página Web", "Visor", "Effi Inventario"
    description = Column(String, nullable=True)         # Descripción opcional
    project_id = Column(Integer, ForeignKey("projects.id"))
    source_connection_id = Column(Integer, ForeignKey("connections.id"))  # La Tabla Master
    source_sheet_name = Column(String, nullable=False)  # Hoja dentro de la Master
    # JSON string: {"Nombre_Final": "title", "Stock": "inventory_count"}
    # (retrocompat: mapeo directo columna→columna, solo renombra)
    columns_mapping = Column(Text, nullable=False)
    # JSON string (opcional): lista ordenada de columnas de salida con
    # transformaciones (ver export_engine). Si está, el download la usa en vez
    # de columns_mapping. Es lo que arman las plantillas predefinidas (§11).
    transform_spec = Column(Text, nullable=True)
    # Tipo de salida: 'csv_download' o 'google_sheets'
    output_type = Column(String, default="csv_download")
    # Si output_type == 'google_sheets': sheet destino donde se escriben los datos
    output_spreadsheet_id = Column(String, nullable=True)
    output_sheet_name = Column(String, nullable=True)
    # Token del link fijo de descarga: permite que un sistema externo baje el
    # CSV del canal sin abrir la app (/api/exports/{id}/download?token=...).
    public_token = Column(String, nullable=True, index=True)
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


class ShopifyMasterSyncConfig(Base):
    """Configuración del módulo independiente 'Shopify → Maestra': trae precio/stock
    de una tienda Shopify y actualiza (no crea filas) los SKU que ya están en la
    Tabla Maestra. Registro único (get-or-create), como la Maestra global."""
    __tablename__ = "shopify_master_sync_config"
    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("connections.id"), nullable=True)
    sku_column_master = Column(String, nullable=True)
    price_column_master = Column(String, nullable=True)
    stock_column_master = Column(String, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    last_sync_summary = Column(Text, nullable=True)  # JSON: resumen del último corrido
    created_at = Column(DateTime, default=datetime.utcnow)

    connection = relationship("Connection")


class ShopifySubscription(Base):
    """Destino permanente 'Maestra → Shopify' (fase B). Al ejecutarse un sync que
    escribe la Tabla Maestra, se empuja precio/stock de los SKUs afectados a la
    tienda (misma corrida, en background). Regla dura: NUNCA crea productos en
    Shopify — solo actualiza variantes que cruzan por SKU normalizado."""
    __tablename__ = "shopify_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                     # Ej: "Shopi-Poe"
    connection_id = Column(Integer, ForeignKey("connections.id"), nullable=False)
    # Columnas DE LA MAESTRA que alimentan la tienda (al menos una)
    price_column_master = Column(String, nullable=True)
    stock_column_master = Column(String, nullable=True)
    # Ubicación/bodega destino del stock (gid://shopify/Location/...). Si es nulo
    # y la tienda tiene una sola bodega, se usa esa.
    location_id = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    last_pushed_at = Column(DateTime, nullable=True)
    last_push_summary = Column(Text, nullable=True)  # JSON: resumen del último envío
    created_at = Column(DateTime, default=datetime.utcnow)

    connection = relationship("Connection")


class ApiSubscription(Base):
    """Destino permanente 'Maestra → API genérica' (canal API). Igual que las
    suscripciones Shopify pero contra cualquier endpoint HTTP del cliente:
    al ejecutarse un sync que escribe la Maestra, se empujan en background las
    filas de los SKUs afectados (diff quirúrgico); además hay "Enviar ahora"
    (Maestra completa, con dry_run). El payload por fila se arma con la
    plantilla del canal (transform_spec, mismas transformaciones del export
    engine §11); sin plantilla, la fila va con todas las columnas tal cual."""
    __tablename__ = "api_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)              # Ej: "Effi API"
    url = Column(String, nullable=False)               # Endpoint destino
    http_method = Column(String, default="POST")       # POST o PUT
    # Auth simple por header: {auth_header_name: auth_token}. El token es
    # write-only (nunca se devuelve; el response expone solo has_token).
    auth_header_name = Column(String, default="Authorization")
    auth_token = Column(Text, nullable=True)           # Sensible
    extra_headers = Column(Text, nullable=True)        # JSON stringificado
    # Plantilla del canal (lista ordenada de columnas de salida, export_engine).
    transform_spec = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    last_pushed_at = Column(DateTime, nullable=True)
    last_push_summary = Column(Text, nullable=True)    # JSON del último envío
    created_at = Column(DateTime, default=datetime.utcnow)


class ScheduleConfig(Base):
    """Piloto automático (MEJORAS_TABLASK §5): correr todos los procesos activos
    cada X horas, sin que nadie tenga la app abierta. Registro único
    (get-or-create). Un thread de fondo compara next_run_at contra el reloj;
    como vive en la DB, sobrevive reinicios del servidor."""
    __tablename__ = "schedule_config"
    id = Column(Integer, primary_key=True, index=True)
    enabled = Column(Boolean, default=False)
    interval_hours = Column(Integer, default=6)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_summary = Column(Text, nullable=True)  # JSON del último corrido automático
    created_at = Column(DateTime, default=datetime.utcnow)


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
    # Fuente (Process) cuyo mapeo se usa al empujar datos: si está, el push
    # entra por el túnel real (Lavadero → Guardián → escritura quirúrgica).
    target_process_id = Column(Integer, nullable=True)


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
