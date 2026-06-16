# Actualizar Tablas K

Este proyecto está dividido en dos partes principales: el **backend** en Python (FastAPI) y el **frontend** en React (Vite).

## Requisitos Previos
Debes tener instalado en tu computadora:
1. [Node.js](https://nodejs.org/) (Para poder correr y compilar el frontend).
2. [Python 3.9+](https://www.python.org/downloads/) (Para el backend).
3. [Git](https://git-scm.com/downloads) (O usar GitHub Desktop para subir el código).

## 1. Configurar y Correr el Backend
Abre una terminal y entra en la carpeta `backend`:
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Luego, corre el servidor:
```bash
uvicorn main:app --reload
```
El API estará disponible en http://127.0.0.1:8000/docs.

## 2. Configurar y Correr el Frontend
Abre **otra** terminal y entra en la carpeta `frontend`:
```bash
cd frontend
npm install
npm run dev
```
La aplicación React estará disponible en http://localhost:5173.

## Despliegue en Railway
1. **Sube el código a GitHub**: Ya tienes tu `.gitignore` configurado. Inicializa tu repositorio y súbelo a GitHub (puedes usar GitHub Desktop si no tienes la línea de comandos de git configurada).
2. **Crea un Nuevo Proyecto en Railway** conectando tu repositorio de GitHub.
3. **Servicio Backend**: Configura el *Root Directory* a `/backend` en Railway y establece el *Start Command* a `uvicorn main:app --host 0.0.0.0 --port $PORT`. Añade la base de datos PostgreSQL y las variables de entorno (`DATABASE_URL`).
4. **Servicio Frontend**: Configura el *Root Directory* a `/frontend` en Railway. Railway detectará Vite y compilará la app automáticamente.

---
*Última actualización: 16 de Junio de 2026*
