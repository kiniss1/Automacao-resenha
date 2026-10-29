# desktop-agent/sap_session.py — conexão e login/logout no SAP GUI via SAP GUI Scripting
#
# Pré-requisito: SAP GUI Scripting precisa estar habilitado nos dois lados (cliente e
# servidor) — veja o README.md. Sem isso, win32com.client.GetObject("SAPGUI") falha.

import time
import win32com.client
from config import SAP_SISTEMA_DESCRICAO


class ErroFinalizacaoSap(Exception):
    """Erro esperado durante a automação — o agente para e reporta pro painel,
    em vez de arriscar continuar num estado que o SAP não espera."""
    pass


def conectar():
    """Abre (ou reaproveita) uma conexão com o SAP GUI e devolve a sessão ativa."""
    sap_gui_auto = win32com.client.GetObject("SAPGUI")
    application = sap_gui_auto.GetScriptingEngine

    if application.Children.Count == 0:
        if not SAP_SISTEMA_DESCRICAO:
            raise ErroFinalizacaoSap(
                "Nenhuma conexão SAP aberta e SAP_SISTEMA_DESCRICAO não configurado."
            )
        connection = application.OpenConnection(SAP_SISTEMA_DESCRICAO, True)
    else:
        connection = application.Children(0)

    # Espera a tela carregar
    for _ in range(20):
        if connection.Children.Count > 0:
            break
        time.sleep(0.5)
    if connection.Children.Count == 0:
        raise ErroFinalizacaoSap("Conexão SAP não abriu nenhuma sessão.")

    return connection.Children(0)


def login(session, sap_usuario, sap_senha):
    """Preenche a tela de login padrão do SAP. Os IDs abaixo são os campos padrão
    do SAP GUI (costumam ser os mesmos em qualquer sistema) — mas confirme com o
    gravador de script antes de usar em produção, já que variam por versão."""
    try:
        session.findById("wnd[0]/usr/txtRSYST-BNAME").text = sap_usuario
        session.findById("wnd[0]/usr/pwdRSYST-BCODE").text = sap_senha
        session.findById("wnd[0]").sendVKey(0)  # Enter
    except Exception as e:
        raise ErroFinalizacaoSap(f"Não consegui preencher a tela de login: {e}")

    time.sleep(1)

    # Popup comum: "já logado em outro lugar" — decide por conta própria continuar
    # (encerra a outra sessão) só se isso for realmente o esperado pro vosso cenário;
    # por padrão, para e reporta erro, pra não tomar uma decisão arriscada sozinho.
    titulo_popup = _titulo_janela_popup(session)
    if titulo_popup:
        raise ErroFinalizacaoSap(
            f"Apareceu um popup inesperado no login: \"{titulo_popup}\". "
            "Verifique manualmente (ex: sessão duplicada, senha expirada) e reenvie o job."
        )


def logout(session):
    """Sempre desloga ao fim de cada job — nunca mantém a sessão de um colaborador
    aberta esperando o próximo job de outra pessoa."""
    try:
        session.findById("wnd[0]").sendVKey(12)  # /nend
        time.sleep(0.5)
        # Confirma o popup "Deseja realmente sair do sistema?" se aparecer
        try:
            session.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
        except Exception:
            pass
    except Exception:
        pass  # logout é best-effort — não queremos mascarar o erro original do job


def _titulo_janela_popup(session):
    try:
        return session.findById("wnd[1]").text
    except Exception:
        return None
