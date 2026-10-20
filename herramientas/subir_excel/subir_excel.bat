@echo off
REM Sube los Excel del PC a TablasK. Programalo en el Programador de tareas
REM de Windows un rato antes de la Revision diaria (ej. 6:30 a. m.).
cd /d "%~dp0"
python subir_excel.py %*
