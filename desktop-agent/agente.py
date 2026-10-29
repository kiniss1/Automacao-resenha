# desktop-agent/agente.py — loop principal do robô de finalização de OS no SAP
#
# Roda 24/7 num desktop dedicado, com o SAP GUI aberto (ou pronto pra abrir). A cada
# ciclo, pergunta ao painel (Railway) se tem job na fila; se tiver, loga no SAP com
# as credenciais do colaborador que enviou aquele job, executa os passos do guia de
# encerramento, reporta progresso, e sempre desloga ao final — sucesso ou erro —
# antes de pegar o próximo job (de outra pessoa, possivelmente).

import time
import traceback

import painel_api
import sap_session
from sap_session import ErroFinalizacaoSap
import passos_encerramento as passos
from config import POLL_INTERVAL_SEGUNDOS


def processar_job(job):
    job_id = job["id"]
    session = sap_session.conectar()
    try:
        sap_session.login(session, job["sapUsuario"], job["sapSenha"])

        painel_api.reportar_etapa(job_id, "Localizando a ordem (ZNTR)")
        passos.localizar_ordem(session, job["numeroOrdemSap"])

        painel_api.reportar_etapa(job_id, "Preenchendo mão de obra e veículo")
        passos.preencher_mao_de_obra(session, job)

        if job.get("temAnexo"):
            painel_api.reportar_etapa(job_id, "Anexando ordem/nota escaneadas")
            caminho_anexo = painel_api.baixar_anexo(job_id)
            passos.anexar_arquivo(session, caminho_anexo)

        painel_api.reportar_etapa(job_id, "Selecionando operações e árvore de tarefas")
        passos.marcar_operacoes_suplementos(session)
        passos.selecionar_tarefas_padrao(session)

        painel_api.reportar_etapa(job_id, "Preenchendo datas e horários")
        passos.marcar_todas_linhas_e_ir_pra_datas(session)
        passos.preencher_datas(session, job)

        painel_api.reportar_etapa(job_id, "Verificando custos planejados")
        passos.verificar_custos_planejados(session)

        painel_api.reportar_etapa(job_id, "Confirmando custos (aba Operações)")
        passos.confirmar_linhas_custo(session)

        painel_api.reportar_etapa(job_id, "Verificando custo real")
        tem_nota = passos.verificar_custo_real_e_decidir_nota(session)

        if tem_nota:
            painel_api.reportar_etapa(job_id, "Encerrando a nota de serviço")
            passos.abrir_nota(session)
            passos.preencher_dados_defeito(session, job)
            passos.preencher_medidas(session, job)
            passos.preencher_acoes(session, job)
            passos.encerrar_ordem_e_nota(session)

        painel_api.marcar_concluido(job_id)
        print(f"[JOB {job_id}] concluído com sucesso.")

    except ErroFinalizacaoSap as e:
        painel_api.marcar_erro(job_id, str(e))
        print(f"[JOB {job_id}] erro esperado: {e}")

    except Exception as e:
        # Erro inesperado (não é um dos checados por nós) — reporta mesmo assim,
        # em vez de deixar o job preso em "processando" pra sempre.
        painel_api.marcar_erro(job_id, f"Erro inesperado: {e}")
        print(f"[JOB {job_id}] ERRO INESPERADO:")
        traceback.print_exc()

    finally:
        sap_session.logout(session)


def loop_principal():
    print("[AGENTE SAP] Iniciado. Aguardando jobs...")
    while True:
        try:
            job = painel_api.proximo_job()
            if job:
                print(f"[AGENTE SAP] Peguei o job {job['id']} (ordem {job['numeroOrdemSap']}).")
                processar_job(job)
            else:
                time.sleep(POLL_INTERVAL_SEGUNDOS)
        except Exception as e:
            print(f"[AGENTE SAP] Erro no ciclo principal (vai tentar de novo): {e}")
            time.sleep(POLL_INTERVAL_SEGUNDOS)


if __name__ == "__main__":
    loop_principal()
