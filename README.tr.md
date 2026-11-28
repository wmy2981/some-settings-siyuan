[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **Türkçe** | [Português](README.pt-BR.md)

# Some Settings

> Bir dizi **bağımsız olarak açılıp kapatılabilen** SiYuan iyileştirmesi: her ayar öğesi tek tek etkinleştirilebilir veya devre dışı bırakılabilir.

Geri bildirim ve özellik önerilerinizi bekliyoruz: lütfen [bir sorun bildirin](https://github.com/wmy2981/some-settings-siyuan/issues/new/choose).

## Özellikler

Kategoriler, her ayarın etkilediği yerel SiYuan özelliğine göre belirlenir ve ayarlar panelindeki sekmelerle eşleşir.

### Yapay zekâ

* Aracı panelinde DeepSeek bakiyesi
* Aracı iletisini Enter ile gönder
* Aracının önerdiği istemleri gizle
* Aracı düşünme başlığını sabitle
* Aracının araç çağrılarında ayrıntı
* Aracı düşüncesini çevir

### Düzenleyici

* Kod dilini hiç anımsama
* Web bağlantısı açmadan önce onayla
* Varlık menüsünde dosya boyutu ve meta veriler
* Eğik çizgi menüsünden assets içinde dosya oluştur
* Kayıt bildirimi yerine yüzen pencere
* Başlık simgesinde başlık düzeyi
* Satır içi kod için kopyalama düğmesi
* Seçim araç çubuğunu gizle

### Belge ağacı

* İlk belge için sabit simge
* Yer imi bir nota açtığında son konuma git
* Açık nota vurgu
* Belge ağacı başlıklarında satır içi Markdown
* Sekme başlıklarında satır içi Markdown
* Boşta kalan sekmeleri kapat
* Anahat başlık düzeyi sınırı
* Mobil belge ağacı başlık boyutu 3.8.9'a geri
* Günlük notu doğrudan oluştur
* Yeni belgeleri sabit konumda oluştur

### Görünüm

* İletişim kutularının arkasında bulanıklık
* Çıkış ekranı bulanıklığını koru
* Daha ince masaüstü komut paneli
* Mobil dock çubuğunun arkasında bulanıklık
* Daha akıcı mobil çubuklar
* Daha yüksek mobil aday paneli
* Çekmece yüksekliği içeriğine uyar
* Mobilde Senkronize et'i her zaman göster
* Mobil açılır listeler için yerel SiYuan görünümü
* Mobil uzun basma menüsünde etiketler
* Blok simgesini mobilde görünür tut
* Mobil Çık düğmesini gizle

### Bağlantı

* Bağlantı kesildi panelinde yeniden bağlan düğmesi
* Bağlantı kesildikten sonra otomatik yeniden bağlanma

### Ayarlar

* Çıkmadan önce onay iste
* Aliyun OSS kova kullanımı
* Kod parçacıkları için söz dizimi vurgulaması
* Masaüstünde F12 geliştirici araçlarını açar kapatır
* Konsol günlüğü görüntüleyicisi

### Mağaza

* Mağaza paketleri için özel simgeler
* Mağaza paketlerini yazara göre engelle
* Mağaza - İndirildi listelerinde bağış düğmelerini gizle
* Eklenti ayarları çekmecesi mobilde tam ekran açılır

### Bu eklenti

* Ayrıntılı günlük çıktısı
* Kullanılamayan ayarları göster
* Ayarlar panelinde arama
* Bu eklentinin yapılandırmasını temizle
* Bu eklenti hakkında
* Bu eklentinin yapılandırmasını içe ve dışa aktar

## Kurulum

1. **SiYuan mağazası**: **Ayarlar → Mağaza** bölümünü açın, _Some Settings_ paketini bulup kurun; sonraki güncellemeler
   de aynı yoldan gelir.
2. **Sürüm indirme**: [sürümler](https://github.com/wmy2981/some-settings-siyuan/releases) sayfasından
   `package.zip` dosyasını indirip `<workspace>/data/plugins/some-settings-siyuan/` dizinine çıkarın;
   `plugin.json` doğrudan bu klasörde yer alsın, ardından SiYuan'ı yeniden başlatın.
3. **Kaynaktan derleme**: depoyu klonlayın, `npm install` ve ardından `npm run build` komutlarını çalıştırın
   (Node 24 veya üzeri gerekir); derleme `package.zip` ve düz bir `dist/` oluşturur, ikisinden birini aynı
   klasöre çıkarın.

Ardından **Ayarlar → Mağaza → İndirildi → Some Settings → Ayarlar** bölümünü açın. Tek giriş noktası burasıdır:
eklenti üst çubuk düğmesi, durum çubuğu öğesi ve dock öğesi eklemez. Panel, kendi
**Ayarları ayrı bir pencerede aç** ayarınızı izler: açıksa ayrı bir pencerede, kapalıysa her zamanki iletişim kutusunda açılır.

## Gelişmiş kullanım

* Kendi makinenizde özellik bildirimlerini ve arayüz metinlerini geçersiz kılmak için
  [Kullanıcı düzeyinde bildirim yaması: `.patch.yml`](docs/patch.tr.md) sayfasına bakın.
* Uyumluluk çakışmalarını gidermek amacıyla başka bir SiYuan eklentisinden bu eklentinin ayarlarını açmak, kapatmak veya
  devralmak için [Harici Eklenti Kontrol API'si](docs/api.tr.md) sayfasına bakın.

## Mağaza istatistikleri grafiği

![Mağaza istatistikleri grafiği](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/some-settings-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=en)

## Geliştirme

Node.js 24 veya üzeri gerekir. Depoyu klonladıktan sonra:

```bash
npm ci              # bağımlılıkları kur
npm run dev         # kaynakları izle, index.js / index.css / i18n dosyalarını depo köküne yaz
npm run build       # özellik bildirimlerini doğrula, ardından dist/ ve package.zip oluştur
npm run check       # yalnızca özellik bildirimlerini ve tüm dil dosyalarını doğrula
npm run typecheck   # TypeScript tür denetimi
npm run lint        # ESLint
npm run format      # dprint ile biçimlendir (format:check yalnızca denetler)
npm test            # birim testleri (vitest)
```

## Lisans

[AGPL-3.0-or-later](./LICENSE)

Eklentiyle birlikte sunulan üçüncü taraf içerikler ve eklentiyi derlemek ve test etmek için kullanılan araçlar
[üçüncü taraf bildirimleri](./THIRD_PARTY_NOTICES.md) sayfasında listelenir.
