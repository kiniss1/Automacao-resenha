# desktop-agent/config.py — configuração do agente, via variáveis de ambiente
import os

BASE_URL = os.environ.get("PAINEL_BASE_URL", "https://SEU-APP.up.railway.app")
AGENTE_TOKEN = os.environ.get("AGENTE_SAP_TOKEN", "")
SAP_SISTEMA_DESCRICAO = os.environ.get("SAP_SISTEMA_DESCRICAO", "")  # nome da conexão no SAP Logon

POLL_INTERVAL_SEGUNDOS = int(os.environ.get("POLL_INTERVAL_SEGUNDOS", "7"))
PASTA_TEMP_ANEXOS = os.environ.get("PASTA_TEMP_ANEXOS", r"C:\Automacao\sap-agente\anexos")
