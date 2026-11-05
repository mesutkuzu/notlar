# Notlar

Sade, tek sayfalık kişisel yazı arşivi. GitHub Pages üzerinde çalışır; yazılar `data/posts.json` içinde tutulur.

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

Anahtar yalnızca tarayıcının `localStorage` alanında tutulur; repoya veya siteye yazılmaz. Ortak kullanılan bir cihazda oturum açma. Anahtar sızarsa GitHub üzerinden iptal et.

> Not: Statik bir sitede editör sayfasının varlığı gizlenemez; güvenlik sınırı erişim anahtarıdır. Anahtar olmadan hiçbir değişiklik yazılamaz.

## Kullanım

- **Yeni yazı:** Studio → “+ Yeni yazı”. Başlık, tarih ve metni gir.
- **Yayınla:** Sağ üstteki “Yayınla”. GitHub'a commit atılır; siteyi yenilediğinde görünür.
- **Sil:** Editörün sağ üstündeki “Sil”.
- **Site adı / yazar:** Studio → “Ayarlar”.
- **Taslaklar:** Yazarken cihazda otomatik saklanır. Yayınlanana kadar repoya gitmez.

Yazı listesi GitHub'daki güncel `data/posts.json` dosyasından okunur. Yayınlama veya silme sonrası siteyi yenilemen yeterlidir; GitHub Pages build'i beklenmez. (HTML/CSS/JS değişiklikleri için Pages build'i yine gerekir.)

Yazılar Markdown destekler: başlık (`##`), kalın, italik, liste, alıntı, bağlantı, görsel ve kod.

## Yerel geliştirme

```bash
python3 -m http.server 8080
```

- Ana sayfa: `http://localhost:8080/`
- Yazı: `http://localhost:8080/post.html?id=baslamak-uzerine`
- Studio: `http://localhost:8080/studio/`

## Dosyalar

```text
index.html              ana sayfa
post.html               yazı detayı
studio/index.html       yazma alanı (ana sayfadan link yok)
data/posts.json         yazılar
data/site.json          site adı ve yazar
assets/css/base.css     renkler, tipografi, ortak parçalar
assets/css/site.css     okuma arayüzü
assets/css/editor.css   studio arayüzü
assets/js/index.js      ana sayfa + arama/filtre
assets/js/post.js       yazı detayı
assets/js/editor.js     studio
assets/js/github.js     GitHub Contents API
```

## GitHub Pages

Repo public. Pages kaynağı **GitHub Actions** (`main`). `.github/workflows/pages.yml` yalnızca kod değişikliklerinde çalışır; `data/**` commit'leri deploy tetiklemez. Site yazıları zaten GitHub raw üzerinden canlı okuduğu için içerik değişiklikleri anında görünür.

## Not

`data/posts.json` içindeki yazılar başlangıç örnekleridir. Studio'dan düzenleyebilir veya silebilirsin. Site herkese açıktır; gizli bilgi yazma.
