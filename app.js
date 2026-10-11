// ============================================
// APLIKASI KAS PENGAJIAN AL HIKMAH
// app.js - Versi terbaru dan perbaikan API
// ============================================

const API_URL = 'https://script.google.com/macros/s/AKfycbyJaQJus17QR3NEcshSfZbeQD8bdlAYGmN0ve0wN6vpormHesQLNouTwWsnn8qBnfpyVA/exec';

const DEFAULT_CATEGORIES = {
  Pemasukan: [
    'Iuran jamaah', 'Donasi', 'Infak',
    'Sedekah', 'Sumbangan', 'Lainnya'
  ],
  Pengeluaran: [
    'Konsumsi', 'Transportasi', 'Perlengkapan',
    'Kegiatan pengajian', 'Listrik/Air',
    'Santunan', 'Lainnya'
  ]
};

// ============================================
// DATA DAN UTILITAS
// ============================================

const $ = id => document.getElementById(id);

let transactions = [];
let CATEGORIES = readCategories();
let installPrompt = null;
let apiRequestNumber = 0;
let postRequestNumber = 0;

function readCategories() {
  try {
    const value = JSON.parse(
      localStorage.getItem('kasPengajianCategories') || 'null'
    );

    if (
      value &&
      Array.isArray(value.Pemasukan) &&
      Array.isArray(value.Pengeluaran)
    ) {
      return value;
    }
  } catch (error) {
    console.warn('Kategori lokal tidak dapat dibaca:', error);
  }

  return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();

  return new Date(date.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function currentMonth() {
  return localDateString().slice(0, 7);
}

function rupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function apiReady() {
  return API_URL.startsWith('https://script.google.com/macros/s/') &&
    API_URL.endsWith('/exec');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function formatThousands(value) {
  const digits = String(value || '').replace(/\D/g, '');

  return digits
    ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : '';
}

function amountNumber(value) {
  return Number(
    String(value || '')
      .replace(/\./g, '')
      .replace(/\D/g, '')
  ) || 0;
}

function showToast(message) {
  const element = $('toast');
  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    element.classList.remove('show');
  }, 3000);
}

function setButtonState(id, disabled, text) {
  const button = $(id);
  if (!button) return;

  button.disabled = disabled;

  if (text !== undefined) {
    button.textContent = text;
  }
}

// ============================================
// PENGELOLAAN KATEGORI
// ============================================

function setCategories() {
  const selected = document.querySelector(
    'input[name="jenis"]:checked'
  );

  const select = $('kategori');
  if (!select) return;

  const type = selected ? selected.value : 'Pemasukan';
  const oldValue = select.value;
  const categories = CATEGORIES[type] || [];

  select.innerHTML = categories.map(category =>
    `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
  ).join('');

  if (categories.includes(oldValue)) {
    select.value = oldValue;
  }
}

function saveCategories() {
  try {
    localStorage.setItem(
      'kasPengajianCategories',
      JSON.stringify(CATEGORIES)
    );
  } catch (error) {
    console.error('Gagal menyimpan kategori:', error);
    showToast('Kategori tidak dapat disimpan di perangkat.');
  }

  setCategories();
  renderCategorySettings();
}

function selectedCategoryType() {
  const selected = document.querySelector(
    'input[name="categoryJenis"]:checked'
  );

  return selected ? selected.value : 'Pemasukan';
}

function renderCategorySettings() {
  const container = $('categorySettingsList');
  if (!container) return;

  const type = selectedCategoryType();
  const categories = CATEGORIES[type] || [];

  container.innerHTML = categories.map((name, index) => `
    <div class="category-setting-row">
      <input
        aria-label="Nama kategori"
        data-category-name="${index}"
        value="${escapeHtml(name)}"
        maxlength="60"
      >
      <button
        type="button"
        class="secondary smallbtn"
        data-category-save="${index}"
      >Simpan</button>
      <button
        type="button"
        class="dangerbtn smallbtn"
        data-category-delete="${index}"
      >Hapus</button>
    </div>
  `).join('') ||
    '<div class="empty">Belum ada kategori. Tambahkan kategori baru di atas.</div>';
}

function openCategorySettings(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const modal = $('categoryModal');

  if (!modal) {
    showToast('Panel pengaturan kategori tidak ditemukan.');
    return;
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  renderCategorySettings();
}

function closeCategorySettings() {
  const modal = $('categoryModal');
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

// ============================================
// MEMUAT DATA GOOGLE SHEETS - JSONP
// ============================================

function loadData() {
  const list = $('transactionList');

  if (!list) {
    console.error('Elemen transactionList tidak ditemukan.');
    return;
  }

  if (!apiReady()) {
    list.innerHTML =
      '<div class="empty">URL Apps Script belum diatur dengan benar.</div>';
    return;
  }

  // Setiap permintaan memiliki nomor agar respons lama
  // tidak menimpa hasil permintaan terbaru.
  const requestNumber = ++apiRequestNumber;

  // Batalkan permintaan JSONP yang sebelumnya.
  const oldScript = $('apiJsonp');

  if (oldScript) {
    oldScript.remove();
  }

  if (window.kasApiTimeout) {
    clearTimeout(window.kasApiTimeout);
    window.kasApiTimeout = null;
  }

  list.innerHTML =
    '<div class="empty">Memuat data dari Google Sheets...</div>';

  const callback = 'receiveSheetData';
  let selesai = false;

  function bersihkan() {
    selesai = true;

    if (window.kasApiTimeout) {
      clearTimeout(window.kasApiTimeout);
      window.kasApiTimeout = null;
    }

    const scriptLama = $('apiJsonp');

    if (scriptLama) {
      scriptLama.remove();
    }

    if (window[callback] === callbackHandler) {
      try {
        delete window[callback];
      } catch (error) {
        window[callback] = undefined;
      }
    }
  }

  function callbackHandler(payload) {
    if (selesai || requestNumber !== apiRequestNumber) return;

    bersihkan();

    if (
      !payload ||
      payload.ok !== true ||
      !Array.isArray(payload.data)
    ) {
      console.error('Respons API tidak valid:', payload);

      list.innerHTML = `
        <div class="empty">
          Data dari Google Sheets tidak valid.
          Periksa deployment Apps Script dan judul kolom spreadsheet.
        </div>
      `;

      if (payload && payload.message) {
        console.error('Pesan API:', payload.message);
      }

      return;
    }

    transactions = payload.data.map(item => ({
      id: String(item.id ?? ''),
      tanggal: String(item.tanggal ?? '').slice(0, 10),
      jenis: String(item.jenis ?? '').trim(),
      kategori: String(item.kategori ?? '').trim(),
      keterangan: String(item.keterangan ?? ''),
      jumlah: Number(item.jumlah) || 0
    }));

    console.log(
      'Data Google Sheets berhasil diterima:',
      transactions.length,
      'transaksi'
    );

    render();
  }

  window[callback] = callbackHandler;

  const script = document.createElement('script');
  script.id = 'apiJsonp';

  script.onerror = function() {
    if (selesai || requestNumber !== apiRequestNumber) return;

    bersihkan();

    list.innerHTML = `
      <div class="empty">
        Gagal menghubungi Google Sheets.
        Periksa koneksi internet, izin Web App, dan deployment Apps Script.
      </div>
    `;

    console.error('Gagal memuat script JSONP dari Google Apps Script.');
  };

  // Jika script selesai dimuat tetapi callback tidak dijalankan,
  // kemungkinan deployment tidak mengembalikan format JSONP.
  script.onload = function() {
    if (selesai || requestNumber !== apiRequestNumber) return;

    bersihkan();

    list.innerHTML = `
      <div class="empty">
        API merespons tetapi callback JSONP tidak dijalankan.
        Periksa apakah deployment Apps Script sudah menggunakan kode terbaru.
      </div>
    `;

    console.error(
      'Respons dimuat tanpa callback JSONP. Periksa parameter callback di Code.gs.'
    );
  };

  script.src =
    API_URL +
    '?action=api&callback=' +
    encodeURIComponent(callback) +
    '&t=' +
    Date.now();

  document.body.appendChild(script);

  // Timeout 30 detik untuk koneksi ponsel yang lambat.
  window.kasApiTimeout = setTimeout(function() {
    if (selesai || requestNumber !== apiRequestNumber) return;

    bersihkan();

    list.innerHTML = `
      <div class="empty">
        Permintaan data melewati batas waktu.
        Periksa koneksi internet lalu tekan tombol Muat Ulang.
      </div>
    `;

    console.error('Permintaan API melewati batas waktu 30 detik.');
  }, 30000);
}

// ============================================
// MENAMPILKAN TRANSAKSI DAN SALDO
// ============================================

function render() {
  const monthFilter = $('monthFilter');
  const typeFilter = $('typeFilter');
  const searchInput = $('searchInput');

  const month = monthFilter
    ? monthFilter.value || currentMonth()
    : currentMonth();

  const type = typeFilter ? typeFilter.value : '';
  const query = searchInput
    ? searchInput.value.trim().toLowerCase()
    : '';

  const monthRows = transactions.filter(item =>
    String(item.tanggal || '').slice(0, 7) === month
  );

  const totalMasuk = transactions
    .filter(item => item.jenis === 'Pemasukan')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  const totalKeluar = transactions
    .filter(item => item.jenis === 'Pengeluaran')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  const masuk = monthRows
    .filter(item => item.jenis === 'Pemasukan')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  const keluar = monthRows
    .filter(item => item.jenis === 'Pengeluaran')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  if ($('saldo')) {
    $('saldo').textContent = rupiah(totalMasuk - totalKeluar);
  }

  if ($('pemasukan')) {
    $('pemasukan').textContent = rupiah(masuk);
  }

  if ($('pengeluaran')) {
    $('pengeluaran').textContent = rupiah(keluar);
  }

  if ($('jumlahTransaksi')) {
    $('jumlahTransaksi').textContent =
      `${transactions.length} transaksi keseluruhan`;
  }

  if ($('historySubtitle')) {
    $('historySubtitle').textContent = `Bulan ${month}`;
  }

  const rows = monthRows.filter(item =>
    (!type || item.jenis === type) &&
    `${item.kategori || ''} ${item.keterangan || ''} ${item.tanggal || ''}`
      .toLowerCase()
      .includes(query)
  );

  const list = $('transactionList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        ${monthRows.length
          ? 'Tidak ada transaksi yang cocok dengan filter atau pencarian.'
          : 'Belum ada transaksi pada bulan ini.'}
      </div>
    `;
    return;
  }

  list.innerHTML = rows.map(item => {
    const income = item.jenis === 'Pemasukan';

    return `
      <article class="transaction">
        <div class="txicon ${income ? 'in' : 'out'}">
          ${income ? '↗' : '↘'}
        </div>

        <div class="txdetails">
          <strong>${escapeHtml(item.kategori)}</strong>
          <small>
            ${escapeHtml(item.tanggal)}
            ${item.keterangan
              ? ' · ' + escapeHtml(item.keterangan)
              : ''}
          </small>
        </div>

        <div class="txright">
          <div class="txamount ${income ? 'in' : 'out'}">
            ${income ? '+' : '−'}${rupiah(item.jumlah)}
          </div>
          <button
            type="button"
            class="deletebtn"
            data-delete="${escapeHtml(item.id)}"
          >Hapus</button>
        </div>
      </article>
    `;
  }).join('');
}

// ============================================
// KIRIM DATA KE GOOGLE SHEETS
// ============================================

function ensurePostFrame(form) {
  let frame = $('kasPostFrame');

  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'kasPostFrame';
    frame.name = 'kasPostFrame';
    frame.title = 'Pengiriman data transaksi';
    frame.hidden = true;
    document.body.appendChild(frame);
  }

  form.target = frame.name;
  form.method = 'POST';

  return frame;
}

function submitPost(data) {
  const form = $('postForm');

  if (!form) {
    showToast('Form pengiriman tidak ditemukan.');
    console.error('Elemen postForm tidak ditemukan.');
    return false;
  }

  form.action = API_URL;

  ensurePostFrame(form);

  Object.entries(data).forEach(([key, value]) => {
    let input = form.elements.namedItem(key);

    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      form.appendChild(input);
    }

    input.value = value ?? '';
  });

  postRequestNumber++;
  form.dataset.requestNumber = String(postRequestNumber);

  try {
    form.submit();
    return true;
  } catch (error) {
    console.error('Gagal mengirim transaksi:', error);
    showToast('Transaksi gagal dikirim. Periksa koneksi internet.');
    return false;
  }
}

// Apps Script mengirim hasil doPost() dengan postMessage.
// Cocokkan sumber pesan dengan iframe pengiriman aplikasi.
window.addEventListener('message', function(event) {
  const frame = $('kasPostFrame');

  if (!frame || event.source !== frame.contentWindow) return;

  const result = event.data;

  if (!result || typeof result !== 'object' ||
      typeof result.ok !== 'boolean') {
    return;
  }

  if (result.ok) {
    showToast(result.message || 'Transaksi berhasil diproses.');
    loadData();
  } else {
    showToast(result.message || 'Transaksi gagal diproses.');
    console.error('Apps Script menolak permintaan:', result.message);
  }

  setButtonState('saveBtn', false, 'Simpan transaksi');
});

// ============================================
// TAMBAH TRANSAKSI
// ============================================

function handleTransactionSubmit(event) {
  event.preventDefault();

  if (!apiReady()) {
    showToast('URL Apps Script belum diatur.');
    return;
  }

  const selected = document.querySelector(
    'input[name="jenis"]:checked'
  );

  if (!selected) {
    showToast('Pilih jenis transaksi.');
    return;
  }

  const tanggal = $('tanggal');
  const kategori = $('kategori');
  const keterangan = $('keterangan');
  const jumlah = $('jumlah');

  if (!tanggal || !kategori || !jumlah) {
    showToast('Form transaksi belum lengkap.');
    return;
  }

  const data = {
    action: 'add',
    tanggal: tanggal.value,
    jenis: selected.value,
    kategori: kategori.value,
    keterangan: keterangan ? keterangan.value.trim() : '',
    jumlah: String(amountNumber(jumlah.value))
  };

  if (!data.tanggal || Number(data.jumlah) <= 0) {
    showToast('Periksa tanggal dan jumlah transaksi.');
    return;
  }

  setButtonState('saveBtn', true, 'Mengirim…');

  if (!submitPost(data)) {
    setButtonState('saveBtn', false, 'Simpan transaksi');
    return;
  }

  showToast('Permintaan penyimpanan dikirim.');

  // Fallback apabila respons postMessage tidak diterima.
  const requestAtSend = postRequestNumber;

  setTimeout(() => {
    if (postRequestNumber !== requestAtSend) return;

    setButtonState('saveBtn', false, 'Simpan transaksi');

    if (jumlah) jumlah.value = '';
    if (keterangan) keterangan.value = '';

    loadData();
  }, 5000);
}

// ============================================
// HAPUS TRANSAKSI
// ============================================

function handleTransactionListClick(event) {
  const button = event.target.closest('[data-delete]');
  if (!button) return;

  const item = transactions.find(
    transaction => String(transaction.id) === button.dataset.delete
  );

  if (!item) {
    showToast('Transaksi tidak ditemukan. Muat ulang data.');
    return;
  }

  if (!confirm(
    `Hapus transaksi ${item.kategori} sebesar ${rupiah(item.jumlah)}?`
  )) {
    return;
  }

  button.disabled = true;

  const success = submitPost({
    action: 'delete',
    id: item.id
  });

  if (!success) {
    button.disabled = false;
    return;
  }

  showToast('Permintaan penghapusan dikirim.');

  setTimeout(loadData, 5000);
}

// ============================================
// EKSPOR CSV
// ============================================

function exportCSV() {
  const month = $('monthFilter')
    ? $('monthFilter').value || currentMonth()
    : currentMonth();

  const rows = transactions.filter(item =>
    String(item.tanggal || '').slice(0, 7) === month
  );

  if (!rows.length) {
    showToast('Tidak ada transaksi untuk diekspor.');
    return;
  }

  const quote = value =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const csv = '\ufeff' + [
    ['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Jumlah'],
    ...rows.map(item => [
      item.tanggal,
      item.jenis,
      item.kategori,
      item.keterangan,
      item.jumlah
    ])
  ].map(row => row.map(quote).join(';')).join('\r\n');

  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  );

  const link = document.createElement('a');
  link.href = url;
  link.download = `kas-pengajian-${month}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================
// CETAK LAPORAN
// ============================================

function printReport() {
  const month = $('monthFilter')
    ? $('monthFilter').value || currentMonth()
    : currentMonth();

  const type = $('typeFilter') ? $('typeFilter').value : '';
  const query = $('searchInput')
    ? $('searchInput').value.trim().toLowerCase()
    : '';

  const rows = transactions.filter(item =>
    String(item.tanggal || '').slice(0, 7) === month &&
    (!type || item.jenis === type) &&
    `${item.kategori || ''} ${item.keterangan || ''} ${item.tanggal || ''}`
      .toLowerCase()
      .includes(query)
  );

  const masuk = rows
    .filter(item => item.jenis === 'Pemasukan')
    .reduce((sum, item) => sum + Number(item.jumlah || 0), 0);

  const keluar = rows
    .filter(item => item.jenis === 'Pengeluaran')
    .reduce((sum, item) => sum + Number(item.jumlah || 0), 0);

  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    showToast('Izinkan pop-up untuk mencetak laporan.');
    return;
  }

  const safe = value => String(value ?? '').replace(/[&<>"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[char]);

  printWindow.document.write(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laporan Kas Pengajian ${safe(month)}</title>
<style>
body {
  font-family: Arial, sans-serif;
  color: #222;
  padding: 24px;
}
h1, h2, .subtitle {
  text-align: center;
  margin: 6px;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 24px;
}
th, td {
  border: 1px solid #999;
  padding: 8px;
  text-align: left;
  font-size: 12px;
}
th { background: #eaf3ed; }
.totals {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 20px;
  font-weight: bold;
}
.date {
  text-align: right;
  font-size: 12px;
  margin-top: 18px;
}
@media print {
  body { padding: 0; }
}
</style>
</head>
<body>
<h1>Majelis Yasinan “AL HIKMAH”</h1>
<h2>Laporan Kas Pengajian</h2>
<p class="subtitle">Periode ${safe(month)}</p>

<div class="totals">
  <span>Total pemasukan: ${safe(rupiah(masuk))}</span>
  <span>Total pengeluaran: ${safe(rupiah(keluar))}</span>
  <span>Selisih periode: ${safe(rupiah(masuk - keluar))}</span>
</div>

<table>
<thead>
<tr>
  <th>No.</th>
  <th>Tanggal</th>
  <th>Jenis</th>
  <th>Kategori</th>
  <th>Keterangan</th>
  <th>Jumlah</th>
</tr>
</thead>
<tbody>
${rows.map((item, index) => `
<tr>
  <td>${index + 1}</td>
  <td>${safe(item.tanggal)}</td>
  <td>${safe(item.jenis)}</td>
  <td>${safe(item.kategori)}</td>
  <td>${safe(item.keterangan)}</td>
  <td>${safe(rupiah(item.jumlah))}</td>
</tr>
`).join('')}
</tbody>
</table>

<p class="date">
Dicetak: ${safe(new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(new Date()))}
</p>

<script>
window.onload = () => window.print();
<\/script>
</body>
</html>`);

  printWindow.document.close();
}

// ============================================
// INSTALASI PWA
// ============================================

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', event => {
    // Tahan banner otomatis; tombol instalasi menampilkan prompt.
    event.preventDefault();
    installPrompt = event;

    if ($('installBtn')) {
      $('installBtn').classList.remove('hidden');
    }
  });

  const installButton = $('installBtn');
  if (!installButton) return;

  installButton.addEventListener('click', async () => {
    if (!installPrompt) {
      showToast(
        'Jika aplikasi sudah terpasang atau browser tidak mendukung instalasi, gunakan menu Chrome lalu pilih Tambahkan ke layar utama.'
      );
      return;
    }

    installPrompt.prompt();

    try {
      await installPrompt.userChoice;
    } catch (error) {
      console.warn('Pilihan instalasi tidak dapat dibaca:', error);
    }

    installPrompt = null;
    installButton.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;

    if (installButton) {
      installButton.classList.add('hidden');
    }

    showToast('Aplikasi berhasil dipasang.');
  });
}

// ============================================
// INISIALISASI
// ============================================

function initApp() {
  // Form tambah transaksi.
  const transactionForm = $('transactionForm');

  if (transactionForm) {
    transactionForm.addEventListener(
      'submit',
      handleTransactionSubmit
    );
  } else {
    console.error('Elemen transactionForm tidak ditemukan.');
  }

  // Form pengiriman transaksi, jika tersedia.
  const postForm = $('postForm');

  if (postForm) {
    postForm.method = 'POST';
  } else {
    console.error('Elemen postForm tidak ditemukan.');
  }

  // Hapus transaksi.
  const transactionList = $('transactionList');

  if (transactionList) {
    transactionList.addEventListener(
      'click',
      handleTransactionListClick
    );
  }

  // Jenis pemasukan/pengeluaran.
  document.querySelectorAll('input[name="jenis"]')
    .forEach(element => {
      element.addEventListener('change', setCategories);
    });

  // Filter dan pencarian.
  ['monthFilter', 'typeFilter', 'searchInput'].forEach(id => {
    const element = $(id);
    if (!element) return;

    element.addEventListener(
      id === 'searchInput' ? 'input' : 'change',
      render
    );
  });

  // Tombol muat ulang.
  if ($('refreshBtn')) {
    $('refreshBtn').addEventListener('click', loadData);
  }

  // Ekspor CSV.
  if ($('exportBtn')) {
    $('exportBtn').addEventListener('click', exportCSV);
  }

  // Cetak laporan.
  if ($('printBtn')) {
    $('printBtn').addEventListener('click', printReport);
  }

  // Pengaturan kategori.
  if ($('manageCategoriesBtn')) {
    $('manageCategoriesBtn').addEventListener(
      'click',
      openCategorySettings
    );
  }

  if ($('closeCategoryModal')) {
    $('closeCategoryModal').addEventListener(
      'click',
      closeCategorySettings
    );
  }

  if ($('categoryModal')) {
    $('categoryModal').addEventListener('click', event => {
      if (event.target === $('categoryModal')) {
        closeCategorySettings();
      }
    });
  }

  document.querySelectorAll('input[name="categoryJenis"]')
    .forEach(element => {
      element.addEventListener('change', renderCategorySettings);
    });

  // Tambah kategori.
  if ($('addCategoryForm')) {
    $('addCategoryForm').addEventListener('submit', event => {
      event.preventDefault();

      const type = selectedCategoryType();
      const input = $('newCategory');
      const name = input ? input.value.trim() : '';

      if (!name) {
        showToast('Masukkan nama kategori.');
        return;
      }

      if (!CATEGORIES[type]) CATEGORIES[type] = [];

      if (CATEGORIES[type].some(category =>
        category.toLowerCase() === name.toLowerCase()
      )) {
        showToast('Kategori tersebut sudah ada.');
        return;
      }

      CATEGORIES[type].push(name);
      saveCategories();

      if (input) input.value = '';

      showToast('Kategori berhasil ditambahkan.');
    });
  }

  // Edit dan hapus kategori.
  if ($('categorySettingsList')) {
    $('categorySettingsList').addEventListener('click', event => {
      const saveButton = event.target.closest('[data-category-save]');
      const deleteButton = event.target.closest('[data-category-delete]');
      const type = selectedCategoryType();

      if (!CATEGORIES[type]) return;

      if (saveButton) {
        const index = Number(saveButton.dataset.categorySave);
        const input = $('categorySettingsList').querySelector(
          `[data-category-name="${index}"]`
        );

        if (!input) return;

        const name = input.value.trim();

        if (!name) {
          showToast('Nama kategori tidak boleh kosong.');
          return;
        }

        if (CATEGORIES[type].some((category, i) =>
          i !== index && category.toLowerCase() === name.toLowerCase()
        )) {
          showToast('Nama kategori sudah digunakan.');
          return;
        }

        CATEGORIES[type][index] = name;
        saveCategories();
        showToast('Kategori berhasil diubah.');
      }

      if (deleteButton) {
        const index = Number(deleteButton.dataset.categoryDelete);
        const name = CATEGORIES[type][index];

        if (name === undefined) return;

        if (!confirm(
          `Hapus kategori "${name}" dari daftar? Transaksi lama tidak dihapus.`
        )) {
          return;
        }

        CATEGORIES[type].splice(index, 1);
        saveCategories();
        showToast('Kategori berhasil dihapus.');
      }
    });
  }

  // Format angka jumlah.
  if ($('jumlah')) {
    $('jumlah').addEventListener('input', () => {
      const input = $('jumlah');
      const oldPosition = input.selectionStart;
      const oldLength = input.value.length;

      input.value = formatThousands(input.value);

      const newPosition = Math.max(
        0,
        (oldPosition || 0) + input.value.length - oldLength
      );

      try {
        input.setSelectionRange(newPosition, newPosition);
      } catch (error) {
        // Beberapa tipe input tidak mendukung setSelectionRange.
      }
    });
  }

  // Isi tanggal dan bulan saat ini.
  if ($('tanggal')) {
    $('tanggal').value = localDateString();
  }

  if ($('todayDate')) {
    $('todayDate').textContent = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
  }

  if ($('monthFilter') && !$('monthFilter').value) {
    $('monthFilter').value = currentMonth();
  }

  setCategories();
  renderCategorySettings();
  setupInstallPrompt();

  // Muat data setelah seluruh handler siap.
  loadData();

  // Daftarkan Service Worker.
  if (
    'serviceWorker' in navigator &&
    location.protocol.startsWith('http')
  ) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .catch(error => {
          console.error(
            'Service Worker gagal didaftarkan:',
            error
          );
        });
    });
  }
}

// Pastikan elemen HTML tersedia sebelum memasang event.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
