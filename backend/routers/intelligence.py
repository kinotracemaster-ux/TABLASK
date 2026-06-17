from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from .. import models, schemas
from ..database import get_db
from ..services import get_sheet_data
from ..intelligent_engine import detect_potential_keys, auto_map_columns

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])

@router.get("/suggest-sku")
def suggest_sku(connection_id: int, sheet_name: str, db: Session = Depends(get_db)):
    """
    Lee una muestra de datos de la conexión (origen o destino)
    y sugiere cuál es la columna que actúa como SKU (llave principal).
    """
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")
        
    try:
        # Solo necesitamos una muestra pequeña (ej. 100 filas) para la detección
        raw_data = get_sheet_data(conn, f"{sheet_name}!A1:Z100")
        if not raw_data or len(raw_data) < 2:
            return {"suggested_sku": None, "confidence": 0, "reason": "No hay suficientes datos"}
            
        headers = raw_data[0]
        sample_rows = raw_data[1:]
        
        suggestions = detect_potential_keys(headers, sample_rows)
        if suggestions and len(suggestions) > 0:
            top_suggestion = suggestions[0]
            if top_suggestion["confianza"] > 0:
                return {
                    "suggested_sku": top_suggestion["columna"],
                    "confidence": top_suggestion["confianza"],
                    "reason": top_suggestion["razon"]
                }
                
        return {"suggested_sku": None, "confidence": 0, "reason": "No se encontraron candidatos"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/auto-map")
def api_auto_map_columns(source_headers: List[str], target_headers: List[str]):
    """
    Toma listas de columnas de origen y destino y sugiere un mapeo semántico.
    Devuelve un diccionario { "source": "target" } para la UI.
    """
    suggestions = auto_map_columns(source_headers, target_headers)
    mapping_dict = {}
    for sug in suggestions:
        if sug["target_field"]:
            mapping_dict[sug["source_field"]] = sug["target_field"]
            
    return {"mapping": mapping_dict}
