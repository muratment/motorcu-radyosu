# Motorcu Radyosu LiveKit 0.5.0

Bu sürüm, mikslenmiş ses çıkışını LiveKit Cloud SFU'ya gönderir. Dinleyiciler LiveKit odasına ayrı katılımcı token'ı ile bağlanıp sesi alır. API Secret sunucu tarafında `.env` dosyasında kalır; tarayıcıya gönderilmez.

## İlk kurulum (Windows)
1. ZIP arşivini tamamen bir klasöre çıkarın. ZIP'in içinden çalıştırmayın.
2. `SETUP_LIVEKIT.bat` dosyasına çift tıklayın. API Key ve gizli API Secret değerini LiveKit panelinden alıp kendi bilgisayarında bu pencereye girin. Secret yazarken görünmez.
3. LiveKit Dashboard'dan kopyaladığınız API Key'i girin.
4. API Secret'ı girerken karakterler görünmez; yapıştırıp Enter'a basın.
5. `BASLAT.bat` dosyasına çift tıklayın. İlk seferde npm paketlerini kurar ve tarayıcı LiveKit dosyasını hazırlar. Kurulumda belirlediğin PIN kodunu daha sonra bilgisayardaki konsol ekranına da yazmalısın (boş bırakırsan varsayılan 123456).
6. Bilgisayarda `http://localhost:3000` adresini açın.

## İlk canlı ses testi
1. Bilgisayar ve test telefonu aynı Wi-Fi ağına bağlı olsun.
2. Bilgisayarda `Yayın konsolu` sekmesine geçip `Konsola bağlan` düğmesine basın. Yerel denemede PIN boş olabilir.
3. MP3 ekleyin. İsterseniz mikrofon izni verin ve efektleri deneyin.
4. `Yayını başlat` düğmesine basın. Sunucu LiveKit odasına yayıncı token'ı ile bağlanır ve mikslenmiş ses kanalını yayımlar.
5. Telefon tarayıcısında CMD penceresinin yazdığı `http://192.168.x.x:3000` adresini açın. Ad ve soyadla dinleyici olarak bağlanın, ardından `Canlı yayını dinle` düğmesine dokunun.

## Gizli bilgiler
- `.env` dosyası API Key ve API Secret içerir. Kimseye göndermeyin, ekran görüntüsünü paylaşmayın, ZIP arşivine eklemeyin.
- Secret yanlışlıkla paylaşılırsa LiveKit Dashboard'dan API anahtarını yenileyin/iptal edin.
- `SETUP_LIVEKIT.bat` tekrar çalıştırılarak yerel kimlik bilgileri değiştirilebilir.

## Bu sürümün sınırları
- Bu paket bilgisayardan LiveKit Cloud'a gerçek canlı ses aktarımı ekler; bu bir APK değildir.
- Telefonun sayfaya ulaşması için ilk testte aynı Wi-Fi gerekir, çünkü web uygulaması henüz kullanıcının bilgisayarından servis edilir.
- WhatsApp grubundaki farklı şehirlerdeki kişilerin açabilmesi için web uygulaması ve Socket.IO mesaj sunucusu da herkese açık HTTPS adresinde barındırılmalıdır. Yalnızca LiveKit URL'si bu barındırmayı sağlamaz.
- Arka planda/ekran kilitliyken kesintisiz dinleme için daha sonra Android ve iPhone uygulaması geliştirilip test edilmelidir.
- Dinleyicinin yazdığı ad-soyad kimlik doğrulaması değildir.

## Teknik yapı
- Node.js + Express + Socket.IO
- `livekit-server-sdk`: sunucuda kısa ömürlü yayıncı/dinleyici token'ı üretir.
- `livekit-client`: tarayıcı LiveKit SDK'sı; esbuild ile `public/livekit.bundle.js` oluşturulur.
- Audio Web API: MP3, mikrofon ve efektleri tek çıkış kanalında miksler.
