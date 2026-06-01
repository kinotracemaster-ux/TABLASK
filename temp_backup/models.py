from sqlalchemy import Column, Integer, String, ForeignKey, JSON
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class Connection(Base):
    __tablename__ = 'connections'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    spreadsheet_id = Column(String, nullable=False) # El ID que sacamos de la URL
    user_id = Column(Integer, nullable=False)
    
    projects = relationship("Project", back_populates="connection")

class Project(Base):
    __tablename__ = 'projects'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    connection_id = Column(Integer, ForeignKey('connections.id'))
    
    connection = relationship("Connection", back_populates="projects")
    mappings = relationship("FieldMapping", back_populates="project")

class FieldMapping(Base):
    __tablename__ = 'field_mappings'
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey('projects.id'))
    
    # Aquí está la magia dinámica
    source_sheet = Column(String, nullable=False) # Ej: "Productos"
    source_column = Column(String, nullable=False) # Ej: "Nombre"
    target_sheet = Column(String, nullable=False) # Ej: "Base Maestra"
    target_column = Column(String, nullable=False) # Ej: "Nombre Producto"
    is_key = Column(Integer, default=0) # 1 si es el campo clave (Ej: Código)
    
    project = relationship("Project", back_populates="mappings")