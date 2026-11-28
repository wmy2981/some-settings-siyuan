[English](api.md) | [简体中文](api.zh-CN.md) | [繁體中文](api.zh-TW.md) | [日本語](api.ja.md) | **Türkçe** | [Português](api.pt-BR.md)

# Harici Eklenti Kontrol API'si

Başka bir SiYuan eklentisi bu eklentinin bir özelliğiyle uyumluluk çakışması yaşadığında (veya belirli bir özelliği
açıp kapatmak istediğinde), bu eklenti örneğinde sunulan `api` özelliği üzerinden hedef özelliğin kalıcı yapılandırmasını
(`feature-<id>` yapılandırma dosyası; `.patch.yml` bildirim yaması **değil**) değiştirebilir ve isteğe bağlı olarak
kontrolü devralabilir.

## API'ye Erişim ve Yükleme Sırası

SiYuan eklentileri eşzamanlı yükler; eklentiniz `some-settings-siyuan` öncesinde başlayabilir veya bu eklenti yeniden
yüklendiğinde çalışmaya devam edebilir. Hem anında erişimi hem de yaşam döngüsü olaylarını dinlemeniz önerilir:

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

Tam entegrasyon örneği (yeniden yükleme ve kaldırma temizliği dahil):

```ts
export default class MyPlugin extends Plugin {
    private onReady = (event: Event) => {
        const detail = (event as CustomEvent<{api: SomeSettingsApi;}>).detail;
        void this.applyCompatibility(detail.api);
    };

    onload() {
        window.addEventListener("some-settings-siyuan:ready", this.onReady);
        // some-settings-siyuan henüz onload aşamasındayken bile plugin.api mevcuttur;
        // eşzamansız yöntemler başlatmanın tamamlanmasını otomatik olarak bekler.
        const api = getSomeSettingsApi(this);
        if (api) {
            void this.applyCompatibility(api);
        }
    }

    private async applyCompatibility(api: SomeSettingsApi) {
        await api.disableFeature(this, "modal-blur", {
            takeover: true,
            reason: {
                tr: "Bu eklentinin özel pencere stilleriyle çakışıyor",
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

### Yaşam Döngüsü Olayları

| Olay Adı (`window`)           | Ne Zaman Tetiklenir                  | `event.detail` İçeriği         |
| ----------------------------- | ------------------------------------ | ------------------------------ |
| `some-settings-siyuan:ready`  | Bu eklenti `load` işlemini bitirince | `{ pluginName, version, api }` |
| `some-settings-siyuan:unload` | Bu eklenti kaldırıldığında           | `{ pluginName, version }`      |

## İki Kontrol Modu

### 1. Devralma Modu (`takeover: true`)

* Hedef özelliğin yapılandırma dosyasını günceller ve anında uygular;
* Ayarlar panelinde başlık, açıklama ve sarı uyarı metni net biçimde görünmeye devam eder; yalnızca o özelliğe ait **tüm
  etkileşimli denetimler devre dışı bırakılıp grileştirilir**;
* Özelliğin son alt satırı olarak her zaman sarı uyarı satırı gösterilir (değer değişmemiş olsa bile);
* **Devralma kilidi yalnızca mevcut oturumda bellekte tutulur**: eklentiniz her açılışta devralmayı yeniden bildirmeli
  ve `onunload()` içinde `release()` / `releaseAll()` çağırmalıdır. Eklentiniz devre dışı bırakılır, kaldırılır veya
  yeniden başlatmada tekrar bildirmezse kilit otomatik olarak açılır;
* **Devralma bırakıldığında yazılmış yapılandırma değeri korunur** (önceki değere otomatik geri dönülmez).

### 2. Devralmasız Mod (`takeover: false`, varsayılan)

* Hedef özelliğin yapılandırma dosyasını günceller ve **denetimleri kilitlemeden** anında uygular;
* Sarı uyarı satırını yalnızca **yapılandırma değeri gerçekten değiştiğinde** gösterir;
* Uyarı eklentinin özel depolama alanında `external-notices` dosyasında ayrı olarak saklanır (`feature-*` dosyalarına
  veya dışa aktarıma karışmaz) ve yeniden başlatmalarda korunur;
* Kullanıcı bu özelliğin herhangi bir ayarını düzenlediğinde ya da tüm yapılandırmayı temizleyip içe aktardığında uyarı
  otomatik olarak kaldırılır.

## Yöntemler

### `ready(): Promise<void>`

Bu eklentinin başlatılmasının tamamlanmasını bekler. Tüm eşzamansız API yöntemleri bunu dahili olarak bekler.

### `setFeature(request): Promise<ExternalControlResult>`

Parametreler:

| Alan        | Tür                                                | Zorunlu | Açıklama                                                                                               |
| ----------- | -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `caller`    | `string \| { name: string; displayName?: string }` | Evet    | Çağıran eklenti adı veya SiYuan `Plugin` örneği (canlı `displayName` önceliklidir)                     |
| `featureId` | `string`                                           | Evet    | Hedef özellik kimliği (`src/features/<id>` ile aynı, örn. `"modal-blur"`)                              |
| `enabled`   | `boolean \| string`                                | Evet    | Mantıksal anahtarlar için `true` / `false`; seçim kutusu anahtarları için `false` veya geçerli seçenek |
| `takeover`  | `boolean`                                          | Hayır   | Denetimlerin kilitlenip kilitlenmeyeceği (varsayılan `false`)                                          |
| `reason`    | `string \| Partial<Record<string, string>>`        | Hayır   | Yerelleştirilmiş uyarıya eklenecek isteğe bağlı gerekçe (dize veya dil eşlemesi)                       |

Başarılı dönüş:

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

Hatalı dönüş:

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

`setFeature({ caller, featureId, enabled: false, ...options })` kısayoludur. Hem mantıksal hem de seçim kutusu
anahtarlarında çalışır.

### `enableFeature(caller, featureId, options?)`

`setFeature({ caller, featureId, enabled: options?.value ?? true, ...options })` kısayoludur. Birden çok etkin
seçeneğe sahip seçim kutusu anahtarları için `options.value` değerini açıkça belirtin.

### `release(caller, featureId)` ve `releaseAll(caller)`

`caller` tarafından tutulan tek bir özelliğin veya tüm özelliklerin devralma kilidini eşgüçlü biçimde serbest bırakır ve
`{ released: number, featureIds: string[] }` döndürür.

### `getFeatureState(featureId)` ve `listControllableFeatures()`

Özelliğin kullanılabilirliğini, kontrol edilebilirliğini, anahtar meta verilerini, geçerli değerini, çalışma durumunu,
etkin devralmaları ve kalıcı uyarıyı salt okunur olarak döndürür.

## Sınırlar ve Çakışma Kuralları

1. **Korunan özellikler**: `plugin` ("Bu eklenti") kategorisindeki özellikler ve anahtarı olmayan öğeler harici olarak
   kontrol edilemez (`protected` / `no-switch`).
2. **Kullanılamayan özellikler**: mevcut platform/SiYuan sürümünde kullanılamayan veya bildirim/yama ile kapatılmış
   özellikler yazılmaz (`unavailable`).
3. **Çoklu eklenti çakışmaları (uyumluysa paylaşım, çakışmada red)**:
   * Birden çok eklenti aynı özelliği **aynı hedef değerle** devralırsa kilidi birlikte tutar ve tümü bırakana kadar
     kilit açılmaz;
   * Devralınmış bir özellik için başka bir eklentinin devralmasız çağrısı veya **farklı hedef değerli** devralma
     çağrısı `conflict` ile reddedilir (ilk gelen önceliklidir).
4. **Kaldırılan eklenti temizliği**: bir eklenti `releaseAll()` çağırmadan devre dışı bırakılır veya kaldırılırsa,
   ayarlar paneli açıldığında veya API sorgulandığında `app.plugins` içinde olmadığı algılanır ve kilidi otomatik olarak
   temizlenir.
5. **Anlık panel eşitlemesi**: ayarlar paneli açıkken devralma, bırakma veya değişiklik yapıldığında denetim değerleri,
   devre dışı durumu ve sarı uyarı satırı anında güncellenir.
6. **Çoklu pencere ve ayrı ayar penceresi**: masaüstünde her alt pencere ve ayrı ayar penceresi kendi eklenti örneğini
   barındırır; kontrol API'sini yalnızca ana pencereden çağırın ve eşitleme ya da pencereler arası yeniden yükleme
   sonrasında devralmayı yeniden bildirmek için `some-settings-siyuan:ready` olayını dinleyin.
