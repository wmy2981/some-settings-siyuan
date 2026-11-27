[English](patch.md) | [简体中文](patch.zh-CN.md) | [繁體中文](patch.zh-TW.md) | [日本語](patch.ja.md) | **Türkçe** | [Português](patch.pt-BR.md)

# Kullanıcı düzeyinde bildirim yaması: `.patch.yml`

Bir özelliğin hiç sunulup sunulmayacağı, hangi ayarlar sekmesine ait olduğu, hangi ön yüzde geçerli olduğu ve
hangi SiYuan sürümlerini desteklediği, eklenti kaynağındaki özellik bildirimleriyle belirlenir ve eklentiyle
birlikte yayımlanır; arayüz metinleri de eklentiyle birlikte gelen dil dosyalarından gelir. Bunlardan birini
kendi makinenizde değiştirmek isterseniz (örneğin bir özelliği tamamen kapatmak, başka bir sekmeye taşımak,
yalnızca mobil ön yüzde görünmesini sağlamak veya birkaç arayüz metnini yeniden yazmak) eklentinin veri
dizininde bir `.patch.yml` tutabilirsiniz. Eklenti bunu özellikler yüklenmeden **önce** uygular.

Bu dosyayı **yalnızca siz yönetirsiniz**: eklenti hiçbir zaman şablon oluşturmaz, ayarlar panelinde giriş
sunmaz ve dosyayı değişiklikler için izlemez. Panele satır, düğme veya not eklemez.

## Dosyanın konumu

```
<workspace>/data/storage/petal/some-settings-siyuan/.patch.yml
```

Dosya adı sabittir ve nokta ile başlar; her özelliğin kendi `feature-<id>` yapılandırma dosyasının
yanında durur. Dosyanın olmaması yalnızca "yama yok" anlamına gelir, yani olağan durumdur. Eklenti bu dosyayı
oluşturmaz ve hakkında hiçbir şey söylemez.

## Alanlar

Özellik bildirimleri üst düzey `features` anahtarı altında, **özellik kimliğine** göre gruplanır. Her özellik
aşağıdaki beş alandan birini ya da tamamını yazabilir. Yazılmayan alan kaynaktaki bildirimi korur; kısıtlamayı
**kaldırmaz**.

| Alan            | Geçersiz kıldığı bildirim                                   | Geçerli değerler                                                                                                          |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `enabled`       | özelliğin eklentiyle birlikte sunulup sunulmayacağı         | `true` / `false`                                                                                                          |
| `category`      | özelliğin bulunduğu ayarlar sekmesi (birden fazla olabilir) | `ai` / `editor` / `doc-tree` / `appearance` / `connection` / `settings` / `bazaar` / `plugin` veya bunların listesi       |
| `frontends`     | geçerli olduğu ön yüzler                                    | `desktop` / `mobile` listesi; `[]` iki ön yüzde de geçerli değil; `null` veya boş değer kısıtlama olmadığı anlamına gelir |
| `minAppVersion` | desteklenen en düşük SiYuan sürümü (bu sürüm dahil)         | `"3.8.7"` gibi bir SiYuan sürüm dizesi; `null` veya boş değer alt sınırı kaldırır                                         |
| `maxAppVersion` | desteklenen en yüksek SiYuan sürümü (bu sürüm dahil)        | `"3.9.0"` gibi bir SiYuan sürüm dizesi; `null` veya boş değer üst sınırı kaldırır                                         |

`category` alanına sekme etiketi değil sekme kimliği yazılır; `[editor, doc-tree]` gibi bir liste yazmak
özelliğin aynı anda birkaç sekmede görünmesini sağlar, liste boş olamaz ve bir sekmeyi tekrarlayamaz. Sürüm
numaralarını tırnak içine alın: `3.8` geçerli bir sürüm değildir, `"3.8.7"` geçerlidir.

## Örnek

```yaml
features:
  # "Aracı iletisini Enter ile gönder" özelliğini kapat: yapılandırması yüklenmez,
  # bağlanmaz ve varsayılan olarak ayarlar panelinde görünmez
  agent-enter-to-send:
    enabled: false

  # "Düzenleyici" sekmesine taşı ve iki ön yüzde de geçerli kıl
  desktop-command-panel-slim:
    category: editor
    frontends: [desktop, mobile]

  # "Düzenleyici" ve "Belge ağacı" sekmelerinde birlikte göster
  heading-level-icon:
    category: [editor, doc-tree]

  # Yalnızca kendi SiYuan sürümünüzde denemek için
  tab-title-markdown:
    minAppVersion: "3.8.7"
    maxAppVersion: "3.9.0"

  # Kaynaktaki iki kısıtlamayı da kaldır; ön yüz kısıtlaması dahil
  mobile-console-log:
    frontends: null
    maxAppVersion: null
```

Bir özellik aynı anda birkaç alan yazabilir; etkileri birikir. `frontends` alanı blok liste olarak da
yazılabilir:

```yaml
features:
  mobile-dock-blur:
    frontends:
      - mobile
```

## Kısıtlamayı kaldırma

Kaynak zaten `maxAppVersion` bildiriyorsa (SiYuan bu özelliği kendisi uyguladığında bu yama devreden çıkar),
**alanı yazmamak hiçbir şeyi değiştirmez**; özellik daha yeni SiYuan sürümlerinde kendini gizlemeyi sürdürür.
Orada da görünmesini istiyorsanız boş değeri açıkça yazmanız gerekir:

```yaml
features:
  tab-title-markdown:
    maxAppVersion: null # `maxAppVersion:` yazmak da aynı anlama gelir
```

Aynı durum `minAppVersion` ve `frontends` için de geçerlidir. Tersine `frontends: []` "iki ön yüzde de
geçerli değil" anlamına gelir, "ikisi de geçerli" değil: `enabled` alanına dokunmadan bir özelliği kendi
makinenizde durdurmak için boş listeyi kullanın.

## Arayüz metinlerini geçersiz kılma (i18n)

Yama, özellik bildirimlerinin yanı sıra eklentiyle birlikte gelen metinleri de arayüz diline göre geçersiz
kılabilir. Üst düzey anahtar `i18n`, ikinci düzey arayüz dili kodu, üçüncü düzey ise metniyle birlikte
i18n anahtarıdır:

```yaml
i18n:
  en:
    feature.clearConfig.action: "Clear everything"
    panel.unavailable.frontend: "Only available on {platform}"
```

* **Yalnızca geçerli arayüz dili uygulanır.** Eklenti çalışma zamanında tek bir dil dosyası yükler (arayüz
  dilinin dosyasını), bu nedenle başka bir dile ait bölüm uygulanmaz ve değerleri doğrulanmaz; yine de
  `i18n` yapısının tamamı (dil → anahtar/değer tablosu) geçerli olmalıdır. Dil kodu `zh-CN` olarak ya da
  eski alt çizgili `zh_CN` yazımıyla yazılabilir.
* **Yalnızca var olan anahtarlar değiştirilebilir.** Anahtar, eklentiyle birlikte gelen dil dosyasında zaten
  bulunmalıdır; olmayan anahtar atlanır (sonraki alt bölüme bakın). Değerler olduğu gibi kullanılır:
  `{platform}`, `{version}` ve `{count}` gibi yer tutucuları, metni kullanan kod yine doldurur; tıpkı
  cümlenin doğrudan `i18n/<language>.json` dosyasına yazılmasıyla aynı sonucu verir.

### Bilinmeyen özellik kimlikleri ve i18n anahtarları

Yamada adı geçen bir özellik kimliği veya i18n anahtarı bu makinede yoksa (yazım hatası ya da eklenti
güncellemesiyle özellik veya metin kaldırılmış olabilir), yalnızca o girdi **sessizce atlanır**, geri kalanı
geçerli olmaya devam eder. Böylece eski bir yama, bir metni kaldıran bir güncellemeden sonra da çalışır;
dezavantajı, yazım hatasının hiçbir hata üretmemesidir: tek ipucu, ayrıntılı günlükteki `skipped unknown …`
satırıdır.

## Ne zaman devreye girer

* Dosya **eklenti yüklenirken** yalnızca bir kez okunur. Düzenledikten sonra "Ayarlar → Mağaza → İndirildi →
  Some Settings" bölümünde eklentiyi devre dışı bırakıp yeniden etkinleştirin ya da eklentiyi yeniden yükleyin;
  dosyayı hiçbir şey izlemez.
* Metin geçersiz kılmaları, herhangi bir özellik bağlanmadan önce ana programın zaten yüklediği dil dosyasına
  yazılır; bu nedenle panel, iletiler, işlem düğmeleri ve tüm özellikler yamalanmış metni gösterir, panel
  araması da bu metinlerle eşleşir.
* Yama, her özelliğin panelindeki çalıştırma anahtarını değil **özelliğin sunulma bildirimini** değiştirir.
  `enabled: false` ile kapatılan bir özellik hiç yüklenmez; yama ile yeniden açılan bir özelliğin çalışması
  için yine kendi anahtarının açık olması gerekir.
* Bir özelliği kapatmak, eklentinin onu sunmaması anlamına gelir: yapılandırması yüklenmez, bağlanmaz ve
  varsayılan olarak ayarlar panelinde görünmez. "Bu eklenti" sekmesinde "Kullanılamayan ayarları göster"
  açıksa, özellik kendi sekmesinin altında "Yamanız tarafından devre dışı bırakıldı" gerekçesiyle gri gösterilir.
* Yama kategoriyi değiştirebilir: normal girdiler de gri girdiler de yeni sekmeye (ya da birkaç sekmeye)
  taşınır, sekme içindeki sıra yine kayıt sırasını izler.
* Yama ön yüzleri ve sürüm aralığını değiştirebilir; gerekçeler yamalanmış bildirime göre yeniden hesaplanır,
  kaynak bildirimden hiçbir şey kalmaz.

## Hata durumunda ne olur

**Tek bir sorun bile dosyanın tamamını geçersiz kılar**: her özellik eklentiyle birlikte gelen bildirime geri
döner, hiçbir zaman kısmen uygulanmış bir durum oluşmaz. (Tek istisna bilinmeyen bir özellik kimliği veya i18n
anahtarıdır: o girdi atlanır, yukarıya bakın.) Bunun nedenleri şunlardır:

* YAML söz dizimi hataları (ileti satır numarasını taşır);
* `features` ve `i18n` dışında bir üst düzey anahtar ya da `features` alanının "özellik kimliği → alanlar"
  eşlemesi olmaması;
* bilinmeyen bir alan, yanlış türde bir değer;
* "dil → anahtar → metin" yapısında olmayan bir `i18n` bölümü ya da (geçerli dilde var olan bir anahtar için)
  dize olmayan bir değer; boş dize de reddedilir, bilinmeyen anahtar ise değeriyle birlikte atlanır;
* geçersiz bir `category`, geçersiz bir ön yüz, yinelenen bir ön yüz;
* geçersiz bir sürüm numarası ya da kaynak bildirimle birleştirildikten sonra `minAppVersion` değeri
  `maxAppVersion` değerinin üzerinde kaldığı için boşalan bir aralık.

Bu durumda:

* eklenti her zamanki gibi başlar: ayarlar girişi, ayarlar paneli ve diğer tüm özellikler çalışmayı sürdürür;
  bozuk bir yama hiçbir şeyi engellemez;
* ayrıntılı günlük açıksa konsolda nedeni belirten tek bir `WARN` görünür (dosya içeriği hiçbir zaman
  yansıtılmaz);
* eklentinin ayarlar paneli her başarılı açılışından sonra, yamanın geçersiz olduğunu bildiren engelleyici
  olmayan bir ileti gösterilir. Yamanın panelde satırı yoktur; bu ileti olmasaydı hatayı ancak konsolu okuyarak
  fark ederdiniz;
* dosyanın olmaması, boş dosya, yalnızca yorum içeren dosya, `features: {}` ve `i18n: {}` hepsi "geçersiz
  kılma yok" anlamına gelir ve hiçbir hata üretmez.

## Bakım sınırları

* "Yapılandırmayı dışa aktar", "Yapılandırmayı içe aktar" ve "Bu eklentinin yapılandırmasını temizle" yalnızca
  dizindeki `feature-*` yapılandırma dosyalarına dokunur; `.patch.yml` dosyasını **kapsamaz** ve onu hiçbir
  zaman değiştirmez.
* Eklentiyi kaldırmak eklentinin veri dizinindeki hiçbir dosyayı silmez: `.patch.yml` ve her özelliğin
  yapılandırması yerinde kalır, yeniden kurulumdan sonra yine geçerli olur.
* Panel ve panel araması yamanın kendisini hiçbir zaman göstermez: satır, kontrol, yol, içerik veya durum
  yoktur. `i18n` bölümü yalnızca var olan metinleri geçersiz kılar; hiçbir kodun okumadığı bir anahtar
  ekleyemez.

## Desteklenen YAML

Yalnızca bu dosyanın gerçekten gereksinim duyduğu söz dizimi kabul edilir; geri kalan her şey tahmin etmek
yerine hata verir:

* blok eşlemeler, girinti yalnızca boşlukla yapılır (her düzey için iki boşluk iyi bir varsayılandır);
* değerler: boş değer (`key:`, `null`, `~`), `true` / `false`, düz metin, tek ve çift tırnaklı dizeler,
  satır içi listeler `[a, b]`, boş eşleme `{}` ve blok listeler (her satırda bir `- a`);
* yorumlar: tamamı bir satır olan `# …` ya da bir değerden sonra boşlukla ayrılmış `# …` (tırnak içindeki
  `#` yorum sayılmaz).

Desteklenmeyenler: çapalar ve takma adlar (`&` / `*`), birden çok belge (`---`), blok skalerler (`|` / `>`),
`{}` dışındaki satır içi eşlemeler, etiketler (`!!`), sekme girintisi ve belirsiz boolean yazımları
`yes` / `no` / `on` / `off`; bunlar yerine `true` / `false` yazın.

> Yama gelişmiş bir giriş noktasıdır: zorla etkinleştirilen bir özelliğin ya da ön yüzlerini ve sürüm
> sınırlarını değiştirdiğiniz bir özelliğin doğru çalışacağını eklenti garanti etmez.
