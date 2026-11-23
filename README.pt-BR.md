[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [Türkçe](README.tr.md) | **Português**

# Some Settings

> Um conjunto de aprimoramentos do SiYuan **ativáveis de forma independente** — cada item de configuração pode ser ativado ou desativado por conta própria.

Comentários e sugestões de funcionalidades são bem-vindos — [abra uma issue](https://github.com/wmy2981/some-settings-siyuan/issues/new/choose).

## Funcionalidades

As categorias seguem a funcionalidade nativa do SiYuan afetada por cada configuração e correspondem às abas do painel
de configurações.

### IA

* Saldo do DeepSeek no painel do agente
* Enviar a mensagem do agente com Enter
* Ocultar os prompts sugeridos do agente
* Fixar o cabeçalho de raciocínio do agente
* Detalhes das chamadas de ferramentas do agente
* Traduzir o raciocínio do agente

### Editor

* Nunca lembrar a linguagem do código
* Confirmar antes de abrir um link da web
* Tamanho e metadados do arquivo no menu do ativo
* Criar um arquivo em assets pelo menu slash
* Uma janela flutuante no lugar do aviso de gravação
* Nível do título exibido no ícone
* Botão de copiar para código em linha
* Ocultar a barra de ferramentas de seleção

### Árvore de documentos

* Ícone inicial fixo do documento
* Ir para a última posição quando um marcador abre uma nota
* Destaque para a nota aberta
* Markdown em linha nos títulos da árvore de documentos
* Markdown em linha nos títulos das abas
* Fechar abas inativas
* Limite de nível de título no esboço
* Tamanho do título da árvore de documentos do celular de volta à 3.8.9
* Criar a nota diária diretamente
* Criar novos documentos em um local fixo

### Aparência

* Desfoque atrás das caixas de diálogo
* Manter a tela de saída desfocada
* Painel de comandos do desktop mais enxuto
* Desfoque atrás da barra de encaixe do celular
* Barras do celular mais suaves
* Painel de candidatos mais alto no celular
* Altura da gaveta do celular conforme o conteúdo
* Sempre mostrar Sincronizar no celular
* Estilo nativo do SiYuan nos menus suspensos do celular
* Rótulos no menu de toque longo do celular
* Manter o ícone do bloco visível no celular
* Ocultar o botão Sair no celular

### Conexão

* Botão Reconectar no painel de desconexão
* Reconexão automática após uma desconexão

### Configurações

* Perguntar antes de sair
* Uso do bucket do Aliyun OSS
* Realce de sintaxe para snippets
* F12 abre e fecha as ferramentas do desenvolvedor
* Visualizador do log do console

### Mercado

* Ícones personalizados para pacotes do mercado
* Bloquear pacotes do mercado por autor
* Ocultar botões de doação nas listas de baixados do mercado
* Gaveta de configurações do plugin em tela cheia no celular

### Este plugin

* Saída detalhada de logs
* Mostrar configurações indisponíveis
* Pesquisa no painel de configurações
* Limpar a configuração deste plugin
* Sobre este plugin
* Importar e exportar a configuração deste plugin

## Instalação

1. **Mercado do SiYuan** — abra **Configurações → Mercado**, encontre _Some Settings_ e instale; as atualizações
   posteriores chegam pelo mesmo caminho.
2. **Download do lançamento** — baixe o `package.zip` das
   [versões](https://github.com/wmy2981/some-settings-siyuan/releases) e extraia em
   `<workspace>/data/plugins/some-settings-siyuan/`, de modo que o `plugin.json` fique diretamente nessa pasta;
   depois reinicie o SiYuan.
3. **Compilar a partir do código-fonte** — clone o repositório, execute `npm install` e depois `npm run build`
   (Node 24 ou mais recente); a compilação gera o `package.zip` e um `dist/` plano; extraia qualquer um dos dois na
   mesma pasta.

Depois abra **Configurações → Mercado → Baixado → Some Settings → Configurações**. Essa é a única entrada — o plugin
não adiciona botão na barra superior, item na barra de status nem item de encaixe. O painel segue a sua própria
configuração **Abrir configurações em uma janela independente**: uma janela independente quando ela está ativada, a
caixa de diálogo habitual quando está desativada.

## Uso avançado

Consulte [Patch de declaração no nível do usuário: `.patch.yml`](docs/patch.pt-BR.md) para substituir as declarações
de funcionalidades e os textos da interface na sua própria máquina.

## Gráfico de estatísticas do mercado

![Gráfico de estatísticas do mercado](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/some-settings-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=en)

## Desenvolvimento

Requer Node.js 24 ou mais recente. Depois de clonar o repositório:

```bash
npm ci              # instalar as dependências
npm run dev         # observar as fontes e gravar index.js / index.css / i18n na raiz do repositório
npm run build       # validar as declarações de funcionalidades e então gerar dist/ e package.zip
npm run check       # validar apenas as declarações de funcionalidades e todos os arquivos de idioma
npm run typecheck   # verificação de tipos do TypeScript
npm run lint        # ESLint
npm run format      # formatar com o dprint (format:check apenas verifica)
npm test            # testes unitários (vitest)
```

## Licença

[AGPL-3.0-or-later](./LICENSE)

Os materiais de terceiros distribuídos com o plugin e as ferramentas usadas para compilá-lo e testá-lo estão listados
nos [avisos de terceiros](./THIRD_PARTY_NOTICES.md).
