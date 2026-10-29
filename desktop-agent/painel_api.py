# desktop-agent/painel_api.py — fala com o backend do painel (Railway)
import requests
from config import BASE_URL, AGENTE_TOKEN, PASTA_TEMP_ANEXOS
import os


def _headers():
    return {"Authorization": "Bearer " + AGENTE_TOKEN}


def proximo_job():
    """Pede o próximo job da fila. Devolve None se não houver nenhum."""
    r = requests.post(BASE_URL + "/api/agente-sap/proximo-job", headers=_headers(), timeout=30)
    r.raise_for_status()
    corpo = r.json()
    if not corpo.get("ok"):
        raise RuntimeError(corpo.get("error", "Erro desconhecido ao pedir job."))
    return corpo.get("data")


def baixar_anexo(job_id):
    """Baixa o anexo do job (se houver) pra uma pasta temporária local e devolve o caminho."""
    r = requests.get(BASE_URL + f"/api/agente-sap/job/{job_id}/anexo", headers=_headers(), timeout=60)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    os.makedirs(PASTA_TEMP_ANEXOS, exist_ok=True)
    ext = r.headers.get("Content-Type", "").split("/")[-1] or "bin"
    caminho = os.path.join(PASTA_TEMP_ANEXOS, f"anexo_{job_id}.{ext}")
    with open(caminho, "wb") as f:
        f.write(r.content)
    return caminho


def reportar_etapa(job_id, etapa_atual):
    requests.post(
        BASE_URL + f"/api/agente-sap/job/{job_id}/status",
        headers=_headers(), json={"etapa_atual": etapa_atual}, timeout=15,
    )


def marcar_concluido(job_id):
    requests.post(
        BASE_URL + f"/api/agente-sap/job/{job_id}/status",
        headers=_headers(), json={"status": "concluido"}, timeout=15,
    )


def marcar_erro(job_id, mensagem):
    requests.post(
        BASE_URL + f"/api/agente-sap/job/{job_id}/status",
        headers=_headers(), json={"status": "erro", "mensagem": mensagem}, timeout=15,
    )
