# Agente desktop — Finalizador de Ordem (SAP)

Robô que roda 24/7 num computador Windows dedicado, dentro da empresa, e finaliza
Ordens de Serviço no SAP (transação `ZNTR`) seguindo o guia *"ORDENS E NOTAS —
ENCERRAMENTO"*. Ele busca jobs numa fila que mora no painel (Railway), loga no SAP
com a senha pessoal de quem enviou cada job, executa os passos via **SAP GUI
Scripting**, e sempre desloga ao final — sucesso ou erro — antes de pegar o próximo.

Este scaffold está **completo em estrutura**, mas os IDs de tela (`wnd[0]/usr/...`)
usados em `passos_encerramento.py` são **placeholders de exemplo** — o layout real da
transação `ZNTR` só existe no SAP de vocês. Siga a seção "Capturando os IDs reais"
abaixo antes de rodar em produção.

## 1. Requisitos

- Windows, com **SAP GUI for Windows** já instalado e configurado (mesma conexão que
  qualquer colaborador usaria pra abrir o SAP nessa máquina).
- **SAP GUI Scripting habilitado nos dois lados**:
  - No cliente: SAP GUI → menu **Opções** (ou ⌥) → **Acessibilidade & Scripting** →
    marcar **"Habilitar scripting"** (desmarcar os avisos de notificação, se quiser).
  - No servidor: parâmetro `sapgui/user_scripting = TRUE` — quem ativa isso é o time
    de **Basis/TI do SAP**. Sem isso, nada neste scaffold funciona (a chamada
    `win32com.client.GetObject("SAPGUI")` falha).
- **Python 3.10+** instalado nessa máquina.
- Rede de saída (HTTPS) até o painel no Railway.

## 2. Instalação

```powershell
cd desktop-agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Configure as variáveis de ambiente (ex: num arquivo `.env` carregado pelo Agendador
de Tarefas, ou direto no sistema):

```
PAINEL_BASE_URL=https://seu-app.up.railway.app
AGENTE_SAP_TOKEN=<o mesmo valor configurado no Railway como AGENTE_SAP_TOKEN>
SAP_SISTEMA_DESCRICAO=<nome da conexão no SAP Logon, ex: "PRD - Produção">
PASTA_TEMP_ANEXOS=C:\Automacao\sap-agente\anexos
```

## 3. Capturando os IDs reais (obrigatório antes de produção)

Cada `session.findById("wnd[0]/usr/...")` em `passos_encerramento.py` tem um `# TODO`
ao lado. Pra descobrir o valor real de cada um:

1. No SAP GUI, vá em **Opções → Acessibilidade & Scripting → Gravação e Reprodução de
   Script** e inicie uma gravação.
2. Siga o guia *"ORDENS E NOTAS — ENCERRAMENTO"* manualmente, passo a passo, numa
   ordem de teste.
3. Pare a gravação — o SAP GUI gera um script (`.vbs`) com o `id` exato de cada campo
   e botão que você usou.
4. Copie cada `id` do `.vbs` gerado pro `findById(...)` correspondente em
   `passos_encerramento.py`, substituindo o placeholder e removendo o comentário
   `# TODO`.

Faça isso **uma função por vez**, testando cada uma isoladamente antes de passar pra
próxima (veja a seção 5, "Testando com segurança").

## 4. Rodando o agente

```powershell
python agente.py
```

Ele fica em loop, perguntando ao painel se tem job novo a cada poucos segundos
(`POLL_INTERVAL_SEGUNDOS`, padrão 7s).

### Deixando ligado 24/7

Use o **Agendador de Tarefas do Windows**: crie uma tarefa que roda
`python agente.py` com gatilho **"Ao iniciar o sistema"**, configurada pra reiniciar
automaticamente se o processo cair (aba **Configurações** → "Se a tarefa falhar,
reiniciar a cada"). Isso cobre reinícios do PC e travamentos do agente.

## 5. Testando com segurança

**Nunca teste direto numa ordem real de produção.** Antes de ligar o agente em
produção:

1. Peça ao seu time de SAP uma ordem de teste (ambiente de qualidade/sandbox, se
   houver) ou uma ordem real de baixo risco pra validar o fluxo inteiro.
2. Rode cada função de `passos_encerramento.py` isoladamente num script Python
   interativo, conferindo visualmente no SAP GUI que cada passo fez exatamente o que
   devia, **antes** de rodar `agente.py` do início ao fim.
3. Preste atenção especial em `confirmar_linhas_custo()` — é a etapa que o próprio
   material de treinamento avisa que duplica valor se confirmada duas vezes. O código
   já para e reporta erro em vez de arriscar uma segunda confirmação sozinho, mas vale
   acompanhar ao vivo as primeiras vezes.

## 6. Arquivos

| Arquivo | O que faz |
|---|---|
| `agente.py` | Loop principal — pega job, chama os passos em ordem, reporta progresso/erro/conclusão |
| `sap_session.py` | Conecta no SAP GUI, loga, desloga |
| `passos_encerramento.py` | Os ~15 passos do guia de encerramento, um por função |
| `painel_api.py` | Fala com o backend no Railway (pegar job, baixar anexo, reportar status) |
| `config.py` | Configuração via variáveis de ambiente |
