[English](api.md) | [简体中文](api.zh-CN.md) | [繁體中文](api.zh-TW.md) | [日本語](api.ja.md) | [Türkçe](api.tr.md) | **Português**

# API de Controle para Plugins Externos

Quando outro plugin do SiYuan entra em conflito com uma funcionalidade deste plugin (ou precisa alternar uma
funcionalidade específica), ele pode usar a propriedade `api` exposta na instância deste plugin para ativar ou
desativar a configuração persistida do recurso (arquivo `feature-<id>`, **não** o patch `.patch.yml`), com bloqueio de
controle opcional.

## Como descobrir a API e lidar com a ordem de carregamento

O SiYuan carrega plugins de forma concorrente; seu plugin pode iniciar antes de `some-settings-siyuan` ou continuar
carregado enquanto este plugin é recarregado. Trate tanto a consulta imediata quanto os eventos de ciclo de vida:

```ts
import type {Plugin} from "siyuan";

const TARGET = "some-settings-siyuan";
const READY_EVENT = "some-settings-siyuan:ready";
const UNLOAD_EVENT = "some-settings-siyuan:unload";

interface SomeSettingsApi {
    readonly version: number;
    readonly pluginName: string;
    ready(): Promise<void>;
    setFeature(request: {
        caller: string | {name: string; displayName?: string;};
        featureId: string;
        enabled: boolean | string;
        takeover?: boolean;
        reason?: string | Partial<Record<string, string>>;
    }): Promise<unknown>;
    disableFeature(
        caller: string | {name: string; displayName?: string;},
        featureId: string,
        options?: {takeover?: boolean; reason?: string | Partial<Record<string, string>>;},
    ): Promise<unknown>;
    enableFeature(
        caller: string | {name: string; displayName?: string;},
        featureId: string,
        options?: {value?: string; takeover?: boolean; reason?: string | Partial<Record<string, string>>;},
    ): Promise<unknown>;
    release(caller: string | {name: string; displayName?: string;}, featureId: string): {
        released: number;
        featureIds: string[];
    };
    releaseAll(caller: string | {name: string; displayName?: string;}): {
        released: number;
        featureIds: string[];
    };
    getFeatureState(featureId: string): Promise<unknown>;
    listControllableFeatures(): Promise<unknown[]>;
}

const getSomeSettingsApi = (plugin: Plugin): SomeSettingsApi | undefined => {
    const target = plugin.app.plugins.find((item) => item.name === TARGET) as
        | (Plugin & {api?: SomeSettingsApi;})
        | undefined;
    return target?.api;
};
```

Exemplo completo de integração (com suporte a recarregamento e liberação ao descarregar):

```ts
export default class MyPlugin extends Plugin {
    private onReady = (event: Event) => {
        const detail = (event as CustomEvent<{api: SomeSettingsApi;}>).detail;
        void this.applyCompatibility(detail.api);
    };

    onload() {
        window.addEventListener("some-settings-siyuan:ready", this.onReady);
        // plugin.api já está disponível mesmo enquanto some-settings-siyuan ainda executa onload;
        // os métodos assíncronos aguardam a inicialização automaticamente.
        const api = getSomeSettingsApi(this);
        if (api) {
            void this.applyCompatibility(api);
        }
    }

    private async applyCompatibility(api: SomeSettingsApi) {
        await api.disableFeature(this, "modal-blur", {
            takeover: true,
            reason: {
                "pt-BR": "Conflita com os estilos de modal personalizados deste plugin",
                en: "Conflicts with this plugin's custom modal styles",
            },
        });
    }

    onunload() {
        window.removeEventListener("some-settings-siyuan:ready", this.onReady);
        getSomeSettingsApi(this)?.releaseAll(this);
    }
}
```

### Eventos de ciclo de vida

| Nome do evento (`window`)     | Quando é disparado                | Conteúdo de `event.detail`     |
| ----------------------------- | --------------------------------- | ------------------------------ |
| `some-settings-siyuan:ready`  | Após este plugin concluir `load`  | `{ pluginName, version, api }` |
| `some-settings-siyuan:unload` | Quando este plugin é descarregado | `{ pluginName, version }`      |

## Dois modos de controle

### 1. Modo de controle assumido (`takeover: true`)

* Grava o arquivo de configuração do recurso e aplica imediatamente (montando ou desmontando o recurso);
* O título, a descrição e o aviso amarelo permanecem nítidos no painel de configurações, enquanto **todos os controles
  interativos daquele recurso ficam desativados e esmaecidos**;
* Uma linha de aviso amarela permanece sempre visível como última linha filha do recurso (mesmo que o valor já fosse o
  mesmo);
* **O bloqueio existe apenas em memória nesta execução**: seu plugin deve declarar o controle a cada inicialização e
  chamar `release()` / `releaseAll()` em `onunload()`. Se seu plugin for desativado, desinstalado ou não declarar
  novamente após reiniciar, os controles são desbloqueados automaticamente;
* **Ao liberar o controle, o valor gravado na configuração é mantido** (não volta automaticamente ao valor anterior).

### 2. Modo sem controle assumido (`takeover: false`, padrão)

* Grava o arquivo de configuração do recurso e aplica imediatamente **sem bloquear os controles**;
* Exibe o aviso amarelo como última linha filha **somente quando o valor da configuração realmente mudou**;
* O aviso é salvo separadamente em `external-notices` no armazenamento do plugin (nunca misturado aos arquivos
  `feature-*` nem às exportações) e persiste entre reinicializações;
* Assim que o usuário editar qualquer ajuste desse recurso, ou limpar/importar as configurações, o aviso é removido.

## Métodos

### `ready(): Promise<void>`

Resolve quando este plugin conclui sua inicialização. Todos os métodos assíncronos já aguardam essa promessa
internamente.

### `setFeature(request): Promise<ExternalControlResult>`

Parâmetros:

| Campo       | Tipo                                               | Obrigatório | Descrição                                                                                    |
| ----------- | -------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `caller`    | `string \| { name: string; displayName?: string }` | Sim         | Nome do plugin chamador ou instância `Plugin` do SiYuan (`displayName` atual tem prioridade) |
| `featureId` | `string`                                           | Sim         | ID do recurso alvo (corresponde a `src/features/<id>`, ex.: `"modal-blur"`)                  |
| `enabled`   | `boolean \| string`                                | Sim         | `true` / `false` para chaves booleanas; `false` ou opção válida para chaves de seleção       |
| `takeover`  | `boolean`                                          | Não         | Se deve bloquear os controles (padrão `false`)                                               |
| `reason`    | `string \| Partial<Record<string, string>>`        | Não         | Motivo opcional anexado ao aviso localizado (string ou mapa por idioma)                      |

Retorno em caso de sucesso:

```ts
{
    ok: true,
    featureId: string,
    key: string,
    value: boolean | string,
    changed: boolean,
    takeover: boolean,
    release: () => void,
}
```

Retorno em caso de falha:

```ts
{
    ok: false,
    featureId: string,
    code:
        | "invalid-caller"
        | "invalid-feature"
        | "protected"
        | "unavailable"
        | "no-switch"
        | "invalid-value"
        | "readonly"
        | "conflict"
        | "write-failed"
        | "disposed",
    message: string,
    holders?: string[],
}
```

### `disableFeature(caller, featureId, options?)`

Atalho para `setFeature({ caller, featureId, enabled: false, ...options })`. Funciona tanto para chaves booleanas quanto
para seletores.

### `enableFeature(caller, featureId, options?)`

Atalho para `setFeature({ caller, featureId, enabled: options?.value ?? true, ...options })`. Para seletores com várias
opções ativas, passe `options.value` explicitamente.

### `release(caller, featureId)` e `releaseAll(caller)`

Liberam de forma idempotente o controle assumido por `caller` em um recurso específico ou em todos os recursos,
retornando `{ released: number, featureIds: string[] }`.

### `getFeatureState(featureId)` e `listControllableFeatures()`

Consultas somente leitura que retornam disponibilidade, controlabilidade, metadados do interruptor, valor atual, estado
de execução, controles ativos e aviso persistido.

## Limites e regras de conflito

1. **Recursos protegidos**: recursos da categoria `plugin` ("Este plugin") e itens sem interruptor não podem ser
   controlados externamente (`protected` / `no-switch`).
2. **Recursos indisponíveis**: recursos indisponíveis na plataforma/versão atual ou desativados por declaração/patch não
   são gravados (`unavailable`).
3. **Conflitos entre múltiplos plugins (compartilhamento compatível + recusa em conflito)**:
   * Múltiplos plugins assumindo o mesmo recurso com o **mesmo valor alvo** compartilham o bloqueio até que todos o
     liberem;
   * Enquanto houver controle assumido, chamadas sem `takeover` ou com **valor alvo diferente** vindas de outro plugin
     retornam `conflict` (ordem de chegada).
4. **Limpeza automática de plugins descarregados**: se um plugin for desativado ou desinstalado sem chamar
   `releaseAll()`, este plugin detecta sua ausência em `app.plugins` ao abrir o painel ou consultar a API e remove o
   bloqueio automaticamente.
5. **Sincronização ao vivo**: se o painel de configurações estiver aberto durante a chamada ou liberação, os controles e
   a linha de aviso amarela são atualizados em tempo real.
6. **Múltiplas janelas e janela independente de configurações**: no desktop, cada subjanela e janela independente de
   configurações possui sua própria instância do plugin; chame a API de controle apenas na janela principal e
   redeclare o controle ao receber `some-settings-siyuan:ready` após sincronizações ou recarregamentos entre janelas.
