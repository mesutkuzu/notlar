# Aklımın Ucundakiler

Kişisel bir not defteri. Sade, sürükleyerek okunan 3B bir kitap; GitHub Pages üzerinde çalışır ve notlar `data/posts.json` içinde tutulur. Kapak kapalı açılır; sayfalar sürüklenerek çevrilir. Her not, kendi başlığı ve isteğe bağlı başlık görseliyle kitabın bir sayfası olur.

- Site: https://mesutkuzu.github.io/notlar/
- Yazma alanı: https://mesutkuzu.github.io/notlar/studio/

Yazma alanı ana sayfadan linklenmez ve yalnızca GitHub erişim anahtarıyla açılır.

## Yazma alanı

`/studio/` adresine git, GitHub kullanıcı adı, depo ve dal alanlarını doldur (GitHub Pages'te ilk ikisi otomatik gelir), ardından fine-grained bir erişim anahtarı yapıştır.

### Erişim anahtarı

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. **Repository access:** Only select repositories → `notlar`. (“Public repositories / read-only” seçeneği yazma izni vermez.)
3. **Permissions:** **Repositories** sekmesi → **Add permissions** → aramaya **Contents** yaz → **Read and write**. Metadata otomatik olarak read-only gelir.
4. Anahtarı oluştur ve `/studio/` ekranına yapıştır.

`Contents` seçeneği görünmüyorsa klasik token da çalışır: Personal access tokens (classic) → Generate new token → `repo` kutusunu işaretle. Bu anahtar daha geniştir; iş bitince iptal edilebilir.

Anahtar repoya veya siteye yazılmaz. Varsayılan olarak yalnızca studio sekmesi açık kaldığı sürece saklanır; “Bu cihazda hatırla” işaretlenirse tarayıcının `localStorage` alanında tutulur. Ortak kullanılan bir cihazda hatırlama seçeneğini kullanma. Anahtar sızarsa GitHub üzerinden iptal et.

> Not: Statik bir sitede editör sayfasının varlığı gizlenemez; güvenlik sınırı erişim anahtarıdır. Anahtar olmadan hiçbir değişiklik yazılamaz. “Bağlanmadan yerel taslak yaz” yalnızca cihazda taslak oluşturur; depoya erişmez.

## Kullanım

- **Kitap önizlemesi:** “Kitapta önizle” başlığı, görseli ve uzun metnin sayfa bölünmelerini yayınlamadan gösterir.
- **Bağlanmadan yaz:** Giriş ekranındaki “Bağlanmadan taslak yaz” ile başlayabilirsin. Taslak cihazda saklanır; yayınlama için GitHub bağlantısı gerekir.
- **Yeni yazı:** Studio → “+ Yeni yazı”. Başlık, tarih ve metni gir.
- **Başlık görseli:** Üstteki “Başlık görseli” alanına isteğe bağlı olarak bir görsel adresi (`https://…`) veya depo içi yol (`assets/img/…`) yaz. Boş bırakılırsa not görselsiz açılır.
- **Yayınla:** Sağ üstteki “Yayınla”. GitHub'a commit atılır; siteyi yenilediğinde görünür.
- **Sil:** Editörün sağ üstündeki “Sil”.
- **Site adı / yazar:** Studio → “Ayarlar”.
- **Taslaklar:** Yazarken cihazda otomatik saklanır. Yayınlanana kadar repoya gitmez.

Kitap kapalı başlar. Kapağa tıkla veya sürükle; açılan kitapta sayfayı tutup sürükleyerek ilerle. Klavyede `←` `→` tuşları da çalışır. Notlar GitHub'daki güncel `data/posts.json` dosyasından okunur. Yayınlama veya silme sonrası siteyi yenilemen yeterlidir; GitHub Pages build'i beklenmez. (HTML/CSS/JS değişiklikleri için Pages build'i yine gerekir.)

Notlar Markdown destekler: başlık (`##`), kalın, italik, liste, alıntı, bağlantı, görsel ve kod. Uzun notlar sayfalara otomatik bölünür.

## Yerel geliştirme

```bash
python3 -m http.server 8080
```

- Ana sayfa: `http://localhost:8080/`
- Yazı: `http://localhost:8080/post.html?id=musait-bir-zamanda`
- Studio: `http://localhost:8080/studio/`

## Dosyalar

```text
index.html              kitap sahnesi
post.html               tek sayfalık okuma görünümü
studio/index.html       yazma alanı (ana sayfadan link yok)
data/posts.json         notlar
data/site.json          site adı, açıklama ve yazar
assets/css/base.css     renkler, tipografi, ortak parçalar
assets/css/book.css     3B kitap, kapak ve sayfa tipografisi
assets/css/site.css     düz okuma görünümü
assets/css/editor.css   studio arayüzü
assets/js/book.js       kitap motoru, sayfalama ve sürükleme
assets/js/post.js       düz okuma görünümü
assets/js/editor.js     studio
assets/js/github.js     GitHub Contents API
```

## GitHub Pages

Yayın paketi yalnızca site varlıklarını, yazı verilerini, HTML sayfalarını ve manifest dosyalarını içerir.

Repo public. Pages kaynağı **GitHub Actions** (`main`). `.github/workflows/pages.yml` yalnızca kod değişikliklerinde çalışır; `data/**` commit'leri deploy tetiklemez. Site yazıları zaten GitHub raw üzerinden canlı okuduğu için içerik değişiklikleri anında görünür.

## Not

`data/posts.json` yayınlanan yazıları içerir. Studio üzerinden düzenlenebilir. Kitap içindekilerle açılır; yazı listesi ve sayfa numaraları yeni yazılarla otomatik güncellenir. Site herkese açıktır.
