
// ============================================
// APLIKASI KAS PENGAJIAN AL HIKMAH
// app.js - Versi perbaikan
// ============================================

// URL Web App Google Apps Script
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

function readCategories() {
  try {
    const v = JSON.parse(
      localStorage.getItem('kasPengajianCategories') || 'null'
    );

    if (
      v &&
      Array.isArray(v.Pemasukan) &&
      Array.isArray(v.Pengeluaran)
    ) {
      return v;
    }
  } catch (e) {}

  return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}

let CATEGORIES = readCategories();
const $ = id => document.getElementById(id);
let transactions = [];
let installPrompt = null;

function localDateString(d = new Date()) {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function currentMonth() {
  return localDateString().slice(0, 7);
}

function rupiah(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(n) || 0);
}

function apiReady() {
  return API_URL.startsWith(
    'https://script.google.com/macros/s/'
  ) && API_URL.endsWith('/exec');
}

function showToast(msg) {
  const el = $('toast');
  if (!el) return;

  el.textContent = msg;
  el.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function formatThousands(v) {
  const d = String(v || '').replace(/\D/g, '');

  return d
    ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : '';
}

function amountNumber(v) {
  return Number(
    String(v || '')
      .replace(/\./g, '')
      .replace(/\D/g, '')
  ) || 0;
}

// ============================================
// PENGELOLAAN KATEGORI
// ============================================

function setCategories() {
  const selected = document.querySelector(
    'input[name="jenis"]:checked'
  );

  const select = $('kategori');

  if (!selected || !select) return;

  const type = selected.value;
  const old = select.value;

  select.innerHTML = (CATEGORIES[type] || [])
    .map(c =>
      `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
    )
    .join('');

  if ((CATEGORIES[type] || []).includes(old)) {
    select.value = old;
  }
}

function saveCategories() {
  try {
    localStorage.setItem(
      'kasPengajianCategories',
      JSON.stringify(CATEGORIES)
    );
  } catch (e) {
    console.error('Gagal menyimpan kategori:', e);
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

  container.innerHTML = (CATEGORIES[type] || [])
    .map((name, i) => `
      <div class="category-setting-row">
        <input
          aria-label="Nama kategori"
          data-category-name="${i}"
          value="${escapeHtml(name)}"
          maxlength="60"
        >
        <button
          type="button"
          class="secondary smallbtn"
          data-category-save="${i}"
        >Simpan</button>
        <button
          type="button"
          class="dangerbtn smallbtn"
          data-category-delete="${i}"
        >Hapus</button>
      </div>
    `)
    .join('') ||
    '<div class="empty">Belum ada kategori. Tambahkan kategori baru di atas.</div>';
}

function openCategorySettings(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
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

// ============================================
// MEMUAT DATA GOOGLE SHEETS
// ============================================

function loadData() {
  const list = $('transactionList');

  if (!list) {
    console.error('Elemen transactionList tidak ditemukan.');
    return;
  }

  if (!apiReady()) {
    list.innerHTML =
      '<div class="empty">URL Apps Script belum diatur.</div>';
    return;
  }

  list.innerHTML =
    '<div class="empty">Memuat data dari Google Sheets...</div>';

  // Batalkan permintaan sebelumnya.
  const oldScript = document.getElementById('apiJsonp');

  if (oldScript) {
    oldScript.remove();
  }

  if (window.kasApiTimeout) {
    clearTimeout(window.kasApiTimeout);
  }

  // Callback JSONP untuk Google Apps Script.
  const callback = 'receiveSheetData';
  let selesai = false;

  function bersihkan() {
    selesai = true;

    clearTimeout(window.kasApiTimeout);

    const scriptLama = document.getElementById('apiJsonp');

    if (scriptLama) {
      scriptLama.remove();
    }
  }

  window[callback] = function(payload) {
    if (selesai) return;

    bersihkan();

    if (
      !payload ||
      payload.ok !== true ||
      !Array.isArray(payload.data)
    ) {
      console.error('Respons API tidak valid:', payload);

      list.innerHTML =
        '<div class="empty">Respons API tidak valid. Periksa deployment Apps Script dan Console browser.</div>';

      return;
    }

    transactions = payload.data;

    console.log(
      'Data berhasil diterima:',
      transactions.length,
      'transaksi'
    );

    render();
  };

  const script = document.createElement('script');
  script.id = 'apiJsonp';

  script.onerror = function() {
    if (selesai) return;

    bersihkan();

    list.innerHTML =
      '<div class="empty">Gagal menghubungi Google Sheets. Periksa koneksi internet, izin Web App, dan deployment Apps Script.</div>';
  };

  script.src =
    API_URL +
    '?action=api&callback=' +
    encodeURIComponent(callback) +
    '&t=' +
    Date.now();

  document.body.appendChild(script);

  // Batas waktu 15 detik.
  window.kasApiTimeout = setTimeout(function() {
    if (selesai) return;

    bersihkan();

    list.innerHTML =
      '<div class="empty">Permintaan data melewati batas waktu. Muat ulang aplikasi dan periksa koneksi ke Google Sheets.</div>';

    console.error('Permintaan API melewati batas waktu.');
  }, 15000);
}

// ============================================
// MENAMPILKAN TRANSAKSI DAN SALDO
// ============================================

function render() {
  const monthFilter = $('monthFilter');
  const typeFilter = $('typeFilter');
  const searchInput = $('searchInput');

  if (!monthFilter || !typeFilter || !searchInput) {
    console.error('Elemen filter transaksi tidak ditemukan.');
    return;
  }

  const month = monthFilter.value || currentMonth();
  const type = typeFilter.value;
  const query = searchInput.value.trim().toLowerCase();

  const monthRows = transactions.filter(t =>
    String(t.tanggal || '').slice(0, 7) === month
  );

  const totalMasuk = transactions
    .filter(t => t.jenis === 'Pemasukan')
    .reduce((s, t) => s + Number(t.jumlah || 0), 0);

  const totalKeluar = transactions
    .filter(t => t.jenis === 'Pengeluaran')
    .reduce((s, t) => s + Number(t.jumlah || 0), 0);

  const masuk = monthRows
    .filter(t => t.jenis === 'Pemasukan')
    .reduce((s, t) => s + Number(t.jumlah || 0), 0);

  const keluar = monthRows
    .filter(t => t.jenis === 'Pengeluaran')
    .reduce((s, t) => s + Number(t.jumlah || 0), 0);

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

  const rows = monthRows.filter(t =>
    (!type || t.jenis === type) &&
    `${t.kategori || ''} ${t.keterangan || ''} ${t.tanggal || ''}`
      .toLowerCase()
      .includes(query)
  );

  const list = $('transactionList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        ${monthRows.length
          ? 'Tidak ada transaksi yang cocok dengan pencarian.'
          : 'Belum ada transaksi pada bulan ini.'}
      </div>
    `;
    return;
  }

  list.innerHTML = rows.map(t => {
    const income = t.jenis === 'Pemasukan';

    return `
      <article class="transaction">
        <div class="txicon ${income ? 'in' : 'out'}">
          ${income ? '↗' : '↘'}
        </div>

        <div class="txdetails">
          <strong>${escapeHtml(t.kategori)}</strong>
          <small>
            ${escapeHtml(t.tanggal)}
            ${t.keterangan
              ? ' · ' + escapeHtml(t.keterangan)
              : ''}
          </small>
        </div>

        <div class="txright">
          <div class="txamount ${income ? 'in' : 'out'}">
            ${income ? '+' : '−'}${rupiah(t.jumlah)}
          </div>
          <button
            class="deletebtn"
            data-delete="${escapeHtml(t.id)}"
          >Hapus</button>
        </div>
      </article>
    `;
  }).join('');
}

// ============================================
// MENGIRIM DATA KE GOOGLE SHEETS
// ============================================

function submitPost(data) {
  const form = $('postForm');

  if (!form) {
    showToast('Form pengiriman data tidak ditemukan.');
    console.error('Elemen postForm tidak ditemukan.');
    return false;
  }

  form.action = API_URL;

  Object.entries(data).forEach(([key, value]) => {
    if (form.elements[key]) {
      form.elements[key].value = value ?? '';
    }
  });

  form.submit();
  return true;
}

// ============================================
// TAMBAH TRANSAKSI
// ============================================

$('transactionForm').addEventListener('submit', e => {
  e.preventDefault();

  if (!apiReady()) {
    showToast('Atur URL Apps Script terlebih dahulu.');
    return;
  }

  const selected = document.querySelector(
    'input[name="jenis"]:checked'
  );

  if (!selected) {
    showToast('Pilih jenis transaksi.');
    return;
  }

  const data = {
    action: 'add',
    tanggal: $('tanggal').value,
    jenis: selected.value,
    kategori: $('kategori').value,
    keterangan: $('keterangan').value.trim(),
    jumlah: String(amountNumber($('jumlah').value))
  };

  if (!data.tanggal || Number(data.jumlah) <= 0) {
    showToast('Periksa tanggal dan jumlah transaksi.');
    return;
  }

  const btn = $('saveBtn');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyimpan…';
  }

  if (!submitPost(data)) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Simpan transaksi';
    }
    return;
  }

  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Simpan transaksi';
    }

    $('jumlah').value = '';
    $('keterangan').value = '';

    showToast('Permintaan dikirim. Memperbarui data…');

    setTimeout(loadData, 1600);
  }, 700);
});

// ============================================
// HAPUS TRANSAKSI
// ============================================

$('transactionList').addEventListener('click', e => {
  const btn = e.target.closest('[data-delete]');

  if (!btn) return;

  const item = transactions.find(
    t => String(t.id) === btn.dataset.delete
  );

  if (
    !item ||
    !confirm(
      `Hapus transaksi ${item.kategori} sebesar ${rupiah(item.jumlah)}?`
    )
  ) {
    return;
  }

  if (!apiReady()) return;

  btn.disabled = true;

  if (!submitPost({
    action: 'delete',
    id: item.id
  })) {
    btn.disabled = false;
    return;
  }

  showToast('Permintaan hapus dikirim…');

  setTimeout(loadData, 1300);
});

// ============================================
// FILTER, KATEGORI, DAN MUAT ULANG
// ============================================

document.querySelectorAll('input[name="jenis"]')
  .forEach(el => {
    el.addEventListener('change', setCategories);
  });

['monthFilter', 'typeFilter', 'searchInput'].forEach(id => {
  const el = $(id);

  if (el) {
    el.addEventListener(
      id === 'searchInput' ? 'input' : 'change',
      render
    );
  }
});

$('refreshBtn').addEventListener('click', loadData);

// ============================================
// EKSPOR CSV
// ============================================

$('exportBtn').addEventListener('click', () => {
  const month = $('monthFilter').value || currentMonth();

  const rows = transactions.filter(t =>
    String(t.tanggal || '').slice(0, 7) === month
  );

  if (!rows.length) {
    showToast('Tidak ada transaksi untuk diekspor.');
    return;
  }

  const quote = v =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;

  const csv = '\ufeff' + [
    ['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Jumlah'],
    ...rows.map(t => [
      t.tanggal,
      t.jenis,
      t.kategori,
      t.keterangan,
      t.jumlah
    ])
  ]
    .map(r => r.map(quote).join(';'))
    .join('\r\n');

  const url = URL.createObjectURL(
    new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    })
  );

  const a = document.createElement('a');
  a.href = url;
  a.download = `kas-pengajian-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ============================================
// INSTALASI APLIKASI PWA
// ============================================

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();

  installPrompt = e;

  if ($('installBtn')) {
    $('installBtn').classList.remove('hidden');
  }
});

$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;

  installPrompt.prompt();

  await installPrompt.userChoice;

  installPrompt = null;

  $('installBtn').classList.add('hidden');
});

// ============================================
// PENGATURAN KATEGORI
// ============================================

// Delegasi klik untuk tombol pengaturan kategori.
document.addEventListener('click', function(event) {
  const trigger = event.target.closest('#manageCategoriesBtn');

  if (!trigger) return;

  event.preventDefault();
  event.stopPropagation();

  openCategorySettings();
}, true);

$('manageCategoriesBtn').addEventListener(
  'click',
  openCategorySettings
);

$('transactionForm').addEventListener('click', e => {
  if (e.target.closest('#manageCategoriesBtn')) {
    openCategorySettings(e);
  }
});

$('closeCategoryModal').addEventListener('click', () => {
  $('categoryModal').classList.add('hidden');
  $('categoryModal').setAttribute('aria-hidden', 'true');
});

$('categoryModal').addEventListener('click', e => {
  if (e.target === $('categoryModal')) {
    $('categoryModal').classList.add('hidden');
    $('categoryModal').setAttribute('aria-hidden', 'true');
  }
});

document.querySelectorAll('input[name="categoryJenis"]')
  .forEach(el => {
    el.addEventListener('change', renderCategorySettings);
  });

// Tambah kategori.
$('addCategoryForm').addEventListener('submit', e => {
  e.preventDefault();

  const type = selectedCategoryType();
  const name = $('newCategory').value.trim();

  if (!name) return;

  if (CATEGORIES[type].some(
    c => c.toLowerCase() === name.toLowerCase()
  )) {
    showToast('Kategori tersebut sudah ada.');
    return;
  }

  CATEGORIES[type].push(name);

  saveCategories();

  $('newCategory').value = '';

  showToast('Kategori berhasil ditambahkan.');
});

// Edit dan hapus kategori.
$('categorySettingsList').addEventListener('click', e => {
  const saveBtn = e.target.closest('[data-category-save]');
  const deleteBtn = e.target.closest('[data-category-delete]');
  const type = selectedCategoryType();

  if (saveBtn) {
    const i = Number(saveBtn.dataset.categorySave);

    const input = $('categorySettingsList').querySelector(
      `[data-category-name="${i}"]`
    );

    if (!input) return;

    const name = input.value.trim();

    if (!name) {
      showToast('Nama kategori tidak boleh kosong.');
      return;
    }

    if (CATEGORIES[type].some(
      (c, j) =>
        j !== i && c.toLowerCase() === name.toLowerCase()
    )) {
      showToast('Nama kategori sudah digunakan.');
      return;
    }

    CATEGORIES[type][i] = name;

    saveCategories();

    showToast('Kategori berhasil diubah.');
  }

  if (deleteBtn) {
    const i = Number(deleteBtn.dataset.categoryDelete);
    const name = CATEGORIES[type][i];

    if (name === undefined) return;

    if (!confirm(
      `Hapus kategori "${name}" dari daftar? Transaksi lama tidak dihapus.`
    )) {
      return;
    }

    CATEGORIES[type].splice(i, 1);

    saveCategories();

    showToast('Kategori berhasil dihapus.');
  }
});

// ============================================
// FORMAT JUMLAH UANG
// ============================================

$('jumlah').addEventListener('input', () => {
  const input = $('jumlah');
  const pos = input.selectionStart;

  input.value = formatThousands(input.value);

  try {
    input.setSelectionRange(pos, pos);
  } catch (e) {}
});

// ============================================
// CETAK LAPORAN
// ============================================

$('printBtn').addEventListener('click', () => {
  const month = $('monthFilter').value || currentMonth();
  const type = $('typeFilter').value;
  const query = $('searchInput').value.trim().toLowerCase();

  const rows = transactions.filter(t =>
    String(t.tanggal || '').slice(0, 7) === month &&
    (!type || t.jenis === type) &&
    `${t.kategori || ''} ${t.keterangan || ''} ${t.tanggal || ''}`
      .toLowerCase()
      .includes(query)
  );

  const masuk = rows
    .filter(t => t.jenis === 'Pemasukan')
    .reduce((s, t) => s + Number(t.jumlah || 0), 0);

  const keluar = rows
    .filter(t => t.jenis === 'Pengeluaran')
    .reduce((s, t) => s + Number(t.jumlah || 0), 0);

  const w = window.open('', '_blank');

  if (!w) {
    showToast('Izinkan pop-up untuk mencetak laporan.');
    return;
  }

  const safe = v => String(v ?? '').replace(/[&<>"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[c]);

  w.document.write(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Laporan Kas Pengajian ${safe(month)}</title>
<style>
body {
  font-family: Arial, sans-serif;
  color: #222;
  padding: 24px;
}
h1, h2, p {
  text-align: center;
  margin: 5px;
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
th {
  background: #eaf3ed;
}
.totals {
  display: flex;
  gap: 28px;
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
  button { display: none; }
}
</style>
</head>
<body>
<h1>Majelis Yasinan “AL HIKMAH”</h1>
<h2>Laporan Kas Pengajian</h2>
<p>Periode ${safe(month)}</p>

<div class="totals">
  <span>Total pemasukan: ${safe(rupiah(masuk))}</span>
  <span>Total pengeluaran: ${safe(rupiah(keluar))}</span>
  <span>Saldo periode: ${safe(rupiah(masuk - keluar))}</span>
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
${rows.map((t, i) => `
<tr>
  <td>${i + 1}</td>
  <td>${safe(t.tanggal)}</td>
  <td>${safe(t.jenis)}</td>
  <td>${safe(t.kategori)}</td>
  <td>${safe(t.keterangan)}</td>
  <td>${safe(rupiah(t.jumlah))}</td>
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

  w.document.close();
});

// ============================================
// INISIALISASI APLIKASI
// ============================================

$('tanggal').value = localDateString();

$('todayDate').textContent = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
}).format(new Date());

$('monthFilter').value = currentMonth();

setCategories();
loadData();

// Service Worker untuk PWA.
if (
  'serviceWorker' in navigator &&
  location.protocol.startsWith('http')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch(err => console.error(
        'Service Worker gagal didaftarkan:', err
      ));
  });
}
