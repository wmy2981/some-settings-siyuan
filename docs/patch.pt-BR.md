[English](patch.md) | [简体中文](patch.zh-CN.md) | [繁體中文](patch.zh-TW.md) | [日本語](patch.ja.md) | [Türkçe](patch.tr.md) | **Português**

# Patch de declaração no nível do usuário: `.patch.yml`

Se uma funcionalidade é entregue, em qual aba de configurações ela fica, a qual interface se aplica e
quais versões do SiYuan suporta — tudo isso é decidido pelas declarações de funcionalidades no
código-fonte do plugin e publicado junto com ele; os textos da interface também vêm dos arquivos de
idioma distribuídos com o plugin. Se você quiser alterar um desses pontos na sua própria máquina — por
exemplo, desativar uma funcionalidade por completo, movê-la para outra aba, fazê-la aparecer apenas na
interface do celular ou reescrever alguns textos da interface —, pode manter um `.patch.yml` no diretório
de armazenamento do plugin. O plugin o aplica **antes** de carregar as funcionalidades.

Este arquivo é **mantido apenas por você**: o plugin nunca cria um modelo, não oferece entrada no painel
de configurações e não o monitora em busca de alterações. Ele não acrescenta linhas, botões nem
observações ao painel.

## Onde o arquivo fica

```
<workspace>/data/storage/petal/some-settings-siyuan/.patch.yml
```

O nome do arquivo é fixo e começa com um ponto; ele fica ao lado do arquivo de configuração
`feature-<id>` de cada funcionalidade. Um arquivo ausente significa apenas “nenhum patch” — o estado
normal. O plugin não o cria e não diz nada sobre ele.

## Campos

As declarações de funcionalidades ficam sob a chave de nível superior `features`, agrupadas por **id de
funcionalidade**. Cada funcionalidade pode definir um ou todos os cinco campos abaixo. Um campo omitido
mantém a declaração do código-fonte; ele **não** remove uma restrição.

| Campo           | Substitui                                           | Valores válidos                                                                                                   |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`       | se a funcionalidade é entregue com o plugin         | `true` / `false`                                                                                                  |
| `category`      | a(s) aba(s) de configurações em que ela fica        | `ai` / `editor` / `doc-tree` / `appearance` / `connection` / `settings` / `bazaar` / `plugin`, ou uma lista delas |
| `frontends`     | as interfaces a que se aplica                       | uma lista de `desktop` / `mobile`; `[]` significa nenhuma interface; `null` ou vazio significa sem restrição      |
| `minAppVersion` | a versão mais baixa do SiYuan suportada (inclusive) | uma string de versão do SiYuan, como `"3.8.7"`; `null` ou vazio remove o limite inferior                          |
| `maxAppVersion` | a versão mais alta do SiYuan suportada (inclusive)  | uma string de versão do SiYuan, como `"3.9.0"`; `null` ou vazio remove o limite superior                          |

`category` usa o id da aba, não o rótulo da aba. Escreva uma lista, como `[editor, doc-tree]`, para mostrar a
funcionalidade em várias abas ao mesmo tempo; a lista não pode estar vazia nem repetir uma aba. Coloque as versões
entre aspas: `3.8` não é uma versão válida, `"3.8.7"` é.

## Exemplo

```yaml
features:
  # Desativa “Enviar a mensagem do agente com Enter”: a configuração dela não é carregada,
  # ela não é montada e fica fora do painel de configurações por padrão
  agent-enter-to-send:
    enabled: false

  # Move para a aba “Editor” e aplica às duas interfaces
  desktop-command-panel-slim:
    category: editor
    frontends: [desktop, mobile]

  # Mostra nas abas “Editor” e “Árvore de documentos”
  heading-level-icon:
    category: [editor, doc-tree]

  # Testa apenas na sua própria versão do SiYuan
  tab-title-markdown:
    minAppVersion: "3.8.7"
    maxAppVersion: "3.9.0"

  # Remove as duas restrições do código-fonte, inclusive a de interface
  mobile-console-log:
    frontends: null
    maxAppVersion: null
```

Uma única funcionalidade pode definir vários campos; os efeitos se somam. `frontends` também pode ser escrito como uma
lista em bloco:

```yaml
features:
  mobile-dock-blur:
    frontends:
      - mobile
```

## Removendo uma restrição

Quando o código-fonte já declara `maxAppVersion` (o patch se aposenta assim que o upstream implementa a
funcionalidade), **omitir o campo não muda nada** — a funcionalidade continua se ocultando em versões mais
novas do SiYuan. Para fazê-la aparecer nelas, você precisa escrever o valor vazio explicitamente:

```yaml
features:
  tab-title-markdown:
    maxAppVersion: null # `maxAppVersion:` significa a mesma coisa
```

O mesmo vale para `minAppVersion` e `frontends`. Por outro lado, `frontends: []` significa “nenhuma
interface”, não “as duas” — use a lista vazia para parar uma funcionalidade na sua máquina sem mexer em
`enabled`.

## Substituindo textos da interface (i18n)

Além das declarações de funcionalidades, o patch pode substituir os textos que acompanham o plugin, por
idioma da interface. A chave de nível superior é `i18n`, o segundo nível é o código do idioma e o
terceiro nível é a chave de i18n com o seu texto:

```yaml
i18n:
  en:
    feature.clearConfig.action: "Clear everything"
    panel.unavailable.frontend: "Only available on {platform}"
```

* **Apenas o idioma atual da interface é aplicado.** O plugin carrega um único arquivo de idioma em tempo
  de execução (o do idioma da interface), então uma seção para outro idioma não é aplicada e os valores
  dela não são validados; ainda assim, a estrutura geral de `i18n` (idioma → tabela de chave/valor)
  precisa ser válida. O código do idioma pode ser escrito como `zh-CN` ou com o sublinhado legado
  `zh_CN`.
* **Só é possível alterar chaves existentes.** A chave já deve existir no arquivo de idioma distribuído
  com o plugin; uma chave inexistente é ignorada (veja a próxima subseção). Os valores são usados
  literalmente: placeholders como `{platform}`, `{version}` e `{count}` continuam sendo preenchidos
  pelo código que usa o texto, exatamente como se a frase tivesse sido escrita diretamente em
  `i18n/<language>.json`.

### Ids de funcionalidade e chaves de i18n desconhecidos

Quando um id de funcionalidade ou uma chave de i18n indicada pelo patch não existe nesta máquina (um erro
de digitação, ou a funcionalidade ou o texto foi removido por uma atualização do plugin), essa única
entrada é **ignorada silenciosamente** e o restante continua sendo aplicado. Assim, um patch antigo
sobrevive a uma atualização que remove um texto; a desvantagem é que um erro de digitação não gera erro
algum — a linha `skipped unknown …` no log detalhado é a única pista.

## Quando entra em vigor

* O arquivo é lido **quando o plugin carrega**, uma única vez. Depois de editá-lo, desative e ative o
  plugin em “Configurações → Mercado → Baixado → Some Settings”, ou recarregue o plugin; nada monitora o
  arquivo.
* As substituições de texto são gravadas no arquivo de idioma que o host já carregou antes de qualquer
  funcionalidade ser montada, então o painel, as mensagens, os botões de ação e cada funcionalidade
  mostram o texto do patch, e a pesquisa do painel também o encontra.
* O patch altera a **declaração de entrega da funcionalidade**, não o interruptor de execução dentro do
  painel de cada funcionalidade. Uma funcionalidade desligada por `enabled: false` nem chega a ser
  carregada; uma funcionalidade reativada pelo patch ainda precisa ter o próprio interruptor ativado
  para rodar.
* Desligar uma funcionalidade significa que o plugin não a entrega: a configuração dela não é carregada,
  ela não é montada e fica fora do painel de configurações por padrão. Com “Mostrar configurações
  indisponíveis” ativado na aba “Este plugin”, ela aparece em cinza na parte inferior da própria aba, com
  o motivo “Desativado pelo seu patch”.
* O patch pode alterar a categoria: tanto as entradas normais quanto as em cinza vão para a nova aba (ou
  para várias abas), e a ordem dentro da aba continua seguindo a ordem de registro.
* O patch pode alterar as interfaces e o intervalo de versões; os motivos são recalculados a partir da
  declaração do patch, portanto nada da declaração do código-fonte permanece.

## O que acontece em caso de erros

**Qualquer problema isolado invalida o arquivo inteiro**: todas as funcionalidades voltam à declaração
distribuída com o plugin, e nenhum estado parcial é aplicado. (A única exceção é um id de funcionalidade
ou uma chave de i18n desconhecidos: essa entrada é ignorada, veja acima.) Os motivos incluem:

* erros de sintaxe YAML (a mensagem traz o número da linha);
* uma chave de nível superior diferente de `features` e `i18n`, ou `features` que não seja um
  mapeamento “id de funcionalidade → campos”;
* um campo desconhecido, um valor de tipo errado;
* uma seção `i18n` que não seja uma estrutura “idioma → chave → texto”, ou um valor (para uma chave que
  existe no idioma atual) que não seja uma string; uma string vazia também é rejeitada, enquanto uma
  chave desconhecida é ignorada junto com o seu valor;
* uma `category` inválida, uma interface inválida, uma interface duplicada;
* um número de versão inválido, ou um intervalo que acaba vazio porque `minAppVersion` ficou acima de
  `maxAppVersion` após a mesclagem com a declaração do código-fonte.

Quando isso acontece:

* o plugin inicia normalmente — a entrada de configurações, o painel de configurações e todas as outras
  funcionalidades continuam funcionando; um patch quebrado nunca bloqueia nada;
* com o log detalhado ativado, o console mostra um `WARN` com o motivo (o conteúdo do arquivo nunca é
  exibido);
* depois de cada abertura bem-sucedida do painel de configurações do plugin, uma mensagem não bloqueante
  avisa que o patch é inválido. O patch não tem linha no painel, então sem essa mensagem você só
  descobriria o problema lendo o console;
* um arquivo ausente, um arquivo vazio, um arquivo só com comentários, `features: {}` e `i18n: {}`
  significam “nenhuma substituição” e não geram erro algum.

## Limites de manutenção

* “Exportar a configuração”, “Importar a configuração” e “Limpar a configuração deste plugin” só mexem
  nos arquivos de configuração `feature-*` do diretório; eles **não** incluem o `.patch.yml` e nunca o
  modificam.
* Desinstalar o plugin não apaga nada no diretório de armazenamento do plugin: o `.patch.yml` e a
  configuração de cada funcionalidade permanecem no lugar e voltam a valer depois de uma reinstalação.
* O painel e a pesquisa do painel nunca mostram o próprio patch: nenhuma linha, nenhum controle, nenhum
  caminho, nenhum conteúdo, nenhum estado. A seção `i18n` só substitui textos existentes; ela não pode
  acrescentar uma chave que nada lê.

## YAML suportado

Só a sintaxe de que este arquivo realmente precisa é aceita; qualquer outra coisa é um erro, não um
palpite:

* mapeamentos em bloco, indentados apenas com espaços (dois espaços por nível é um bom padrão);
* valores: vazios (`key:`, `null`, `~`), `true` / `false`, texto simples, strings entre aspas simples e
  duplas, listas em linha `[a, b]`, o mapeamento vazio `{}` e listas em bloco (um `- a` por linha);
* comentários: uma linha inteira `# …`, ou `# …` depois de um valor separado por espaço (um `#` dentro
  de aspas não é comentário).

Sem suporte: âncoras e aliases (`&` / `*`), múltiplos documentos (`---`), escalares em bloco (`|` / `>`),
mapeamentos em linha diferentes de `{}`, tags (`!!`), indentação com tabulação e os booleanos ambíguos
`yes` / `no` / `on` / `off` — escreva `true` / `false`.

> O patch é um ponto de entrada avançado: o plugin não promete que uma funcionalidade forçada a ser
> ativada, ou uma cuja interface e limites de versão você alterou, funcione corretamente.
