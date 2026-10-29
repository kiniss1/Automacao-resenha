# desktop-agent/passos_encerramento.py — os passos do guia "ORDENS E NOTAS — ENCERRAMENTO"
# (pptx de 18 slides), modelados como funções de SAP GUI Scripting.
#
# IMPORTANTE: os `session.findById(...)` abaixo usam IDs de EXEMPLO — o layout real
# da transação ZNTR do seu SAP é específico da sua empresa, só dá pra capturar com o
# gravador de script numa sessão real. Veja o README.md ("Como capturar os IDs reais").
# Todo ponto que precisa de um ID real está marcado com `# TODO:`.

import time
from sap_session import ErroFinalizacaoSap


def localizar_ordem(session, numero_ordem_sap):
    """Slide 4 — abre a ZNTR, digita a ordem, data espaçada, marca ABERTA e LIBERADA."""
    session.findById("wnd[0]/tbar[0]/okcd").text = "ZNTR"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(0.5)

    # TODO: confirmar os IDs reais dos campos abaixo com o gravador de script
    session.findById("wnd[0]/usr/ctxtORDEM").text = numero_ordem_sap
    session.findById("wnd[0]/usr/ctxtDATA_DE").text = "01.01.1999"
    session.findById("wnd[0]/usr/ctxtDATA_ATE").text = "01.01.2099"
    session.findById("wnd[0]/usr/chkABERTA").selected = True
    session.findById("wnd[0]/usr/chkLIBERADA").selected = True
    session.findById("wnd[0]/usr/btnRELOGIO").press()  # ícone do relógio
    time.sleep(1)

    if not _ordem_encontrada(session):
        raise ErroFinalizacaoSap(
            f"A transação ZNTR não encontrou a ordem {numero_ordem_sap}. "
            "Confira se o número foi digitado certo."
        )


def preencher_mao_de_obra(session, dados):
    """Slide 5 — horas trabalhadas, funcionários, DTL-VE, veículo, KM."""
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/txtHORAS").text = dados.get("horasTrabalhadas") or ""
    session.findById("wnd[0]/usr/txtQTD_FUNC").text = dados.get("qtdFuncionarios") or ""
    session.findById("wnd[0]/usr/txtDTL_VE").text = dados.get("dtlVe") or ""
    if dados.get("veiculo"):
        session.findById("wnd[0]/usr/txtVEICULO").text = dados["veiculo"]
    if dados.get("km"):
        session.findById("wnd[0]/usr/btnTrocarHHporKMS").press()
        session.findById("wnd[0]/usr/txtKM").text = dados["km"]


def anexar_arquivo(session, caminho_arquivo):
    """Slide 6 — escanear a ordem e/ou nota, clicar na seta, criar anexo, selecionar
    o arquivo. A janela de escolha de arquivo é nativa do Windows (fora do SAP GUI
    Scripting) — por isso usa pywinauto aqui, não session.findById."""
    if not caminho_arquivo:
        raise ErroFinalizacaoSap("Esse job não tem anexo — confira se o colaborador enviou o arquivo.")

    import pywinauto

    # TODO: confirmar os IDs reais dos botões "seta" e "criar anexo"
    session.findById("wnd[0]/usr/btnSeta").press()
    session.findById("wnd[0]/usr/btnCriarAnexo").press()
    time.sleep(1)

    dialog = pywinauto.Desktop(backend="win32").window(title_re=".*(Abrir|Open).*")
    dialog.wait("visible", timeout=10)
    dialog.child_window(class_name="Edit").set_text(caminho_arquivo)
    dialog.child_window(title="&Abrir", class_name="Button").click()
    time.sleep(1)


def marcar_operacoes_suplementos(session):
    """Slide 7 — marca a 3ª linha na aba Operações, vai em Suplementos → Seleção da
    lista de tarefas → aba Árvore de tarefas."""
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/tabsOperacoes/tabpOPERACOES").select()
    session.findById("wnd[0]/usr/tblOperacoes/chkLinha[0,2]").selected = True
    session.findById("wnd[0]/mbar/menu02/menu01").select()  # Suplementos → Seleção lista de tarefas
    session.findById("wnd[0]/usr/tabsArvore/tabpARVORE_TAREFAS").select()


def selecionar_tarefas_padrao(session):
    """Slide 8 — transmissão → subestação → preventiva 1 → NAVR → copiar tarefas."""
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/btnTransmissao").press()
    session.findById("wnd[0]/usr/btnSubestacao").press()
    session.findById("wnd[0]/usr/btnPreventiva1").press()
    session.findById("wnd[0]/usr/chkNAVR").selected = True
    session.findById("wnd[0]/usr/btnCopiarTarefas").press()


def marcar_todas_linhas_e_ir_pra_datas(session):
    """Slide 9 — marca todas as linhas na aba Operações (X), vai pra aba Datas."""
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/btnMarcarTudo").press()
    session.findById("wnd[0]/usr/tabsDatas/tabpDATAS").select()


def preencher_datas(session, dados):
    """Slide 10 — marca Início/Fim obrigatório, preenche data e hora pras 3 entradas
    (serviço, veículo, árvore de tarefas — mesmos valores nas 3), salva."""
    inicio = dados.get("dataHoraInicio")
    fim = dados.get("dataHoraFim")
    if not inicio or not fim:
        raise ErroFinalizacaoSap("Faltam data/hora de início e fim pra preencher as Datas.")

    # TODO: confirmar os IDs reais — repete pras 3 "setas" (serviço, veículo, árvore)
    for _ in range(3):
        session.findById("wnd[0]/usr/chkInicioObrigatorio").selected = True
        session.findById("wnd[0]/usr/chkFimObrigatorio").selected = True
        session.findById("wnd[0]/usr/txtDataInicio").text = inicio["data"]
        session.findById("wnd[0]/usr/txtHoraInicio").text = inicio["hora"]
        session.findById("wnd[0]/usr/txtDataFim").text = fim["data"]
        session.findById("wnd[0]/usr/txtHoraFim").text = fim["hora"]
        session.findById("wnd[0]/usr/btnSetaProximo").press()

    session.findById("wnd[0]/tbar[0]/btn[11]").press()  # salvar


def verificar_custos_planejados(session):
    """Slide 11 (Quadro 1) — reabre a ordem, confere aba Custos (planejado preenchido
    pra Pessoal e Transportes), volta, marca a linha e clica em editar ordem."""
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/tabsCustos/tabpCUSTOS").select()
    if not _tem_valor(session, "wnd[0]/usr/txtCustoPessoalPlanejado"):
        raise ErroFinalizacaoSap("Custo planejado de Pessoal não apareceu — confira a ordem manualmente.")
    session.findById("wnd[0]/tbar[0]/btn[3]").press()  # voltar
    session.findById("wnd[0]/usr/tblOrdens/chkLinha[0,0]").selected = True
    session.findById("wnd[0]/usr/btnEditarOrdem").press()


def confirmar_linhas_custo(session):
    """Slide 12 — a etapa mais arriscada do processo inteiro: o próprio material
    avisa "NUNCA CLICAR PARA CONFIRMAR DUAS VEZES, POIS DUPLICARÁ O VALOR DA ORDEM".
    Por isso cada confirmação aqui é defensiva: confere se a caixa de confirmação
    apareceu antes de seguir, e NUNCA tenta de novo sozinho se ela não aparecer —
    para e deixa pra revisão humana."""
    # TODO: confirmar os IDs reais
    _confirmar_uma_linha(session, linha_index=0)  # 1ª linha
    _confirmar_uma_linha(session, linha_index=1)  # 2ª linha
    # A linha da árvore de tarefas NUNCA é confirmada — fica assim de propósito.
    session.findById("wnd[0]/tbar[0]/btn[3]").press()  # voltar


def _confirmar_uma_linha(session, linha_index):
    session.findById(f"wnd[0]/usr/tblOrdens/chkLinha[{linha_index},0]").selected = True
    session.findById("wnd[0]/usr/btnConfirmar").press()
    time.sleep(1)

    caixa_apareceu = _janela_popup_visivel(session)
    if not caixa_apareceu:
        raise ErroFinalizacaoSap(
            f"Confirmei a linha {linha_index + 1} de custo e a caixa de confirmação não "
            "apareceu. Pra não arriscar duplicar o valor confirmando de novo, parei aqui — "
            "entre no SAP, confira se o custo real já apareceu nessa linha, e só então "
            "reenvie o job (sem marcar essa linha de novo se ela já tiver confirmada)."
        )
    session.findById("wnd[1]/usr/btnSPOP-OPTION1").press()  # OK na caixa de confirmação


def verificar_custo_real_e_decidir_nota(session):
    """Slide 13 — confere custo real x planejado; se não houver Nota, encerra;
    se houver, retorna True pra seguir o fluxo de encerramento da nota."""
    # TODO: confirmar os IDs reais
    tem_nota = _tem_valor(session, "wnd[0]/usr/txtNumeroNota")
    if not tem_nota:
        session.findById("wnd[0]/usr/btnEncerrar").press()
        return False
    return True


def abrir_nota(session):
    """Slide 14 — clica no ícone de óculos ao lado do número da nota."""
    session.findById("wnd[0]/usr/btnOculosNota").press()  # TODO: ID real


def preencher_dados_defeito(session, dados):
    """Slide 15 — equipamento defeituoso, sintoma, descrição resumida, causa."""
    d = dados.get("defeito") or {}
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/cmbEquipamentoDefeituoso").key = d.get("equipamento", "OUTROS")
    session.findById("wnd[0]/usr/cmbSintoma").key = d.get("sintoma", "OUTROS")
    session.findById("wnd[0]/usr/txtDescricaoDefeito").text = d.get("descricao", "")
    session.findById("wnd[0]/usr/cmbCausa").key = d.get("causa", "OUTROS")
    session.findById("wnd[0]/usr/txtDescricaoCausa").text = d.get("descricaoCausa", "")


def preencher_medidas(session, dados):
    """Slide 16 — aba Medidas: defeito, medida, confirmar (bandeira verde), fixar
    (bandeira de encerramento)."""
    m = dados.get("medida") or {}
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/tabsMedidas/tabpMEDIDAS").select()
    session.findById("wnd[0]/usr/cmbDefeito").key = m.get("defeito", "")
    session.findById("wnd[0]/usr/cmbMedida").key = m.get("medida", "")
    session.findById("wnd[0]/usr/tblMedidas/chkLinha[0,0]").selected = True
    session.findById("wnd[0]/usr/btnBandeiraVerde").press()
    session.findById("wnd[0]/usr/btnBandeiraEncerramento").press()


def preencher_acoes(session, dados):
    """Slide 17 — aba Ações: defeito, causa/ação, volta, responde NÃO pra reinserir
    datas de novo."""
    a = dados.get("acao") or {}
    # TODO: confirmar os IDs reais
    session.findById("wnd[0]/usr/tabsAcoes/tabpACOES").select()
    session.findById("wnd[0]/usr/cmbDefeitoAcao").key = a.get("defeito", "")
    session.findById("wnd[0]/usr/cmbCausaAcao").key = a.get("causa", "")
    session.findById("wnd[0]/usr/btnVoltarOrdem").press()
    time.sleep(0.5)
    if _janela_popup_visivel(session):
        session.findById("wnd[1]/usr/btnSPOP-OPTION2").press()  # "Não" reinserir datas


def encerrar_ordem_e_nota(session):
    """Slide 18 — clica na bandeirola pra encerrar ordem e nota de uma vez."""
    session.findById("wnd[0]/usr/btnBandeirolaEncerrar").press()  # TODO: ID real
    time.sleep(1)


# ── Helpers de checagem defensiva ───────────────────────────────────────────

def _janela_popup_visivel(session):
    try:
        session.findById("wnd[1]")
        return True
    except Exception:
        return False


def _tem_valor(session, id_campo):
    try:
        return bool(session.findById(id_campo).text.strip())
    except Exception:
        return False


def _ordem_encontrada(session):
    # TODO: ajustar — geralmente dá pra checar pelo título da janela ou por um
    # campo que só aparece quando a ordem é encontrada.
    try:
        return "não encontrada" not in session.findById("wnd[0]/sbar").text.lower()
    except Exception:
        return True
