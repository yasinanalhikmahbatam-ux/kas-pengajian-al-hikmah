```javascript
'use strict';

// ================================================
// KONFIGURASI GOOGLE SHEETS
// ================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbyJaQJus17QR3NEcshSfZbeQD8bdlAYGmN0ve0wN6vpormHesQLNouTwWsnn8qBnfpyVA/exec';

const DEFAULT_CATEGORIES = {
  Pemasukan: [
    'Iuran jamaah', 'Donasi', 'Infak', 'Sedekah',
    'Sumbangan', 'Kas Mingguan', 'Uang Sewa Tenda',
    'Uang Sewa Kursi+Tenda', 'Lainnya'
  ],
  Pengeluaran: [
    'Konsumsi', 'Transportasi', 'Perlengkapan',
    'Kegiatan pengajian', 'Listrik/Air', 'Santunan',
    'Bisaroh Usdt', 'Komsumsi Goro',
    'Jenguk Orang Sakit', 'Lainnya'
  ]
};

const $ = id => document.getElementById(id);

let transactions = [];
let loadRequestId = 0;
let autoLoadRetry = 0;
let installPrompt = null;
let CATEGORIES = readCategories();

// ================================================
// UTILITAS
// ================================================
function readCategories() {
  try {
    const data = JSON.parse(
      localStorage.getItem('kasPengajianCategories') || 'null'
    );
    if (
      data &&
      Array.isArray(data.Pemasukan) &&
      Array.isArray(data.Pengeluaran)
    ) return data;
  } catch (e) {}

  return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000)
    .toISOString().slice(0, 10);
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function normalizeDate(value) {
  const s = String(value ?? '').trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  const match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? s : localDateString(date);
}

function showToast(message) {
  const el = $('toast');
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    el.classList.remove('show');
  }, 3000);
}

function apiReady() {
  return API_URL.startsWith('https://script.google.com/macros/s/')
    && API_URL.endsWith('/exec');
}

function bind(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

// ================================================
// MEMUAT DATA GOOGLE SHEETS
// ================================================
function loadData(options = {}) {
  const requestId = ++loadRequestId;

  if (!apiReady()) {
    showToast('URL Google Sheets belum benar.');
    return;
  }

  if (!options.automatic || transactions.length === 0) {
    const list = $('transactionList');
    if (list) {
      list.innerHTML =
        '<div class="empty">Memuat data dari Google Sheets...</div>';
    }
  }

  const previous = $('apiJsonp');
  if (previous) previous.remove();

  const callbackName = 'receiveSheetData';

  window[callbackName] = function(payload) {
    if (requestId !== loadRequestId) return;

    delete window[callbackName];
    autoLoadRetry = 0;

    if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
      const list = $('transactionList');
      if (list) {
        list.innerHTML =
          '<div class="empty">Respons API tidak valid. Periksa Apps Script.</div>';
      }
      return;
    }

    // Data tetap berasal dari Google Sheets.
    transactions = payload.data.filter(item => item && typeof item === 'object');

    // Pilih bulan terbaru jika bulan sekarang belum memiliki transaksi.
    const monthFilter = $('monthFilter');

    if (monthFilter && transactions.length) {
      const months = [...new Set(
        transactions
          .map(item => normalizeDate(item.tanggal).slice(0, 7))
          .filter(month => /^\d{4}-\d{2}$/.test(month))
      )].sort();

      if (
        months.length &&
        !transactions.some(
          item => normalizeDate(item.tanggal).slice(0, 7) === currentMonth()
        ) &&
        monthFilter.value === currentMonth()
      ) {
        monthFilter.value = months[months.length - 1];
      }
    }

    render();
  };

  const script = document.createElement('script');
  script.id = 'apiJsonp';
  script.async = true;
  script.src = API_URL
    + '?action=api&callback='
    + encodeURIComponent(callbackName)
    + '&t=' + Date.now();

  script.onerror = function() {
    if (requestId !== loadRequestId) return;

    delete window[callbackName];

    if (transactions.length === 0) {
      const list = $('transactionList');
      if (list) {
        list.innerHTML =
          '<div class="empty">Gagal memuat data. Periksa koneksi internet.</div>';
      }
    }

    if (autoLoadRetry < 3) {
      autoLoadRetry++;
      setTimeout(
        () => loadData({ automatic: true }),
        1500 * autoLoadRetry
      );
    }
  };

  document.body.appendChild(script);
}

// ================================================
// RENDER RINGKASAN DAN RIWAYAT
// ================================================
function render() {
  const month = ($('monthFilter') && $('monthFilter').value)
    || currentMonth();
  const type = ($('typeFilter') && $('typeFilter').value) || '';
  const query = (($('searchInput') && $('searchInput').value) || '')
    .trim().toLowerCase();

  const monthRows = transactions.filter(
    item => normalizeDate(item.tanggal).slice(0, 7) === month
  );

  const totalIncome = transactions
    .filter(item => item.jenis === 'Pemasukan')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  const totalExpense = transactions
    .filter(item => item.jenis === 'Pengeluaran')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  const monthIncome = monthRows
    .filter(item => item.jenis === 'Pemasukan')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  const monthExpense = monthRows
    .filter(item => item.jenis === 'Pengeluaran')
    .reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);

  if ($('saldo')) $('saldo').textContent = rupiah(totalIncome - totalExpense);
  if ($('pemasukan')) $('pemasukan').textContent = rupiah(totalIncome);
  if ($('pengeluaran')) $('pengeluaran').textContent = rupiah(totalExpense);

  if ($('jumlahTransaksi')) {
    $('jumlahTransaksi').textContent =
      `${transactions.length} transaksi`;
  }

  if ($('historySubtitle')) {
    $('historySubtitle').textContent = `Bulan ${month}`;
  }

  // Isi daftar bulan berdasarkan data yang tersedia.
  if ($('monthFilter')) {
    const existing = $('monthFilter').value;
    const months = [...new Set(
      transactions
        .map(item => normalizeDate(item.tanggal).slice(0, 7))
        .filter(value => /^\d{4}-\d{2}$/.test(value))
    )].sort().reverse();

    if (months.length) {
      const select = $('monthFilter');
      const known = [...select.options].map(option => option.value);

      months.forEach(value => {
        if (!known.includes(value)) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          select.appendChild(option);
        }
      });

      if (existing) select.value = existing;
    }
  }

  const rows = monthRows.filter(item => {
    const matchesType = !type || item.jenis === type;
    const text = [
      item.kategori, item.keterangan, item.tanggal, item.jenis
    ].join(' ').toLowerCase();

    return matchesType && text.includes(query);
  });

  const list = $('transactionList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML =
      `<div class="empty">${
        monthRows.length
          ? 'Tidak ada transaksi yang cocok dengan pencarian.'
          : 'Belum ada transaksi pada bulan ini.'
      }</div>`;
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
          <small>${escapeHtml(normalizeDate(item.tanggal))}
            ${item.keterangan ? ' · ' + escapeHtml(item.keterangan) : ''}
          </small>
        </div>
        <div class="txright">
          <div class="txamount ${income ? 'in' : 'out'}">
            ${income ? '+' : '−'}${rupiah(item.jumlah)}
          </div>
          <button type="button" class="deletebtn"
            data-delete="${escapeHtml(item.id)}">Hapus</button>
        </div>
      </article>
    `;
  }).join('');
}

// ================================================
// KATEGORI
// ================================================
function setCategories() {
  const selected = document.querySelector('input[name="jenis"]:checked');
  const categorySelect = $('kategori');

  if (!categorySelect) return;

  const type = selected ? selected.value : 'Pemasukan';
  const oldValue = categorySelect.value;

  categorySelect.innerHTML = (CATEGORIES[type] || [])
    .map(name =>
      `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join('');

  if ((CATEGORIES[type] || []).includes(oldValue)) {
    categorySelect.value = oldValue;
  }
}

function selectedCategoryType() {
  const selected = document.querySelector(
    'input[name="categoryJenis"]:checked'
  );
  return selected ? selected.value : 'Pemasukan';
}

function saveCategories() {
  try {
    localStorage.setItem(
      'kasPengajianCategories',
      JSON.stringify(CATEGORIES)
    );
  } catch (e) {}

  setCategories();
  renderCategorySettings();
}

function renderCategorySettings() {
  const list = $('categorySettingsList');
  if (!list) return;

  const type = selectedCategoryType();

  list.innerHTML = (CATEGORIES[type] || []).map((name, index) => `
    <div class="category-setting-row">
      <input aria-label="Nama kategori"
        data-category-name="${index}"
        value="${escapeHtml(name)}" maxlength="60">
      <button type="button" class="secondary smallbtn"
        data-category-save="${index}">Simpan</button>
      <button type="button" class="dangerbtn smallbtn"
        data-category-delete="${index}">Hapus</button>
    </div>
  `).join('') || '<div class="empty">Belum ada kategori.</div>';
}

function openCategorySettings(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const modal = $('categoryModal');
  if (!modal) {
    showToast('Panel kategori tidak ditemukan di index.html.');
    return;
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  renderCategorySettings();
}

// ================================================
// SIMPAN DAN HAPUS TRANSAKSI
// ================================================
function submitPost(data) {
  const form = $('postForm');

  if (!form) {
    showToast('Form pengiriman tidak ditemukan di index.html.');
    return false;
  }

  form.action = API_URL;

  Object.entries(data).forEach(([key, value]) => {
    if (form.elements[key]) {
      form.elements[key].value = value ?? '';
    } else {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value ?? '';
      form.appendChild(input);
    }
  });

  form.submit();
  return true;
}

bind('transactionForm', 'submit', event => {
  event.preventDefault();

  const date = $('tanggal')?.value;
  const amountText = $('jumlah')?.value || '';
  const amount = Number(amountText.replace(/\D/g, ''));
  const selected = document.querySelector('input[name="jenis"]:checked');

  if (!date || amount <= 0 || !selected) {
    showToast('Periksa tanggal, jenis, dan jumlah transaksi.');
    return;
  }

  const data = {
    action: 'add',
    tanggal: date,
    jenis: selected.value,
    kategori: $('kategori')?.value || 'Lainnya',
    keterangan: $('keterangan')?.value.trim() || '',
    jumlah: String(amount)
  };

  const button = $('saveBtn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Menyimpan...';
  }

  if (!submitPost(data)) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Simpan transaksi';
    }
    return;
  }

  showToast('Permintaan dikirim. Memeriksa data terbaru...');

  setTimeout(() => {
    loadData({ automatic: true });

    if (button) {
      button.disabled = false;
      button.textContent = 'Simpan transaksi';
    }
  }, 1800);
});

bind('transactionList', 'click', event => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;

  const item = transactions.find(
    transaction => String(transaction.id) === button.dataset.delete
  );

  if (!item) return;

  if (!confirm(
    `Hapus transaksi ${item.kategori} sebesar ${rupiah(item.jumlah)}?`
  )) return;

  if (submitPost({ action: 'delete', id: item.id })) {
    showToast('Permintaan hapus dikirim.');
    setTimeout(() => loadData({ automatic: true }), 1800);
  }
});

// ================================================
// EKSPOR CSV
// ================================================
bind('exportBtn', 'click', () => {
  const month = $('monthFilter')?.value || currentMonth();
  const rows = transactions.filter(
    item => normalizeDate(item.tanggal).slice(0, 7) === month
  );

  if (!rows.length) {
    showToast('Tidak ada transaksi untuk diekspor.');
    return;
  }

  const quote = value =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const csv = '\uFEFF' + [
    ['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Jumlah'],
    ...rows.map(item => [
      normalizeDate(item.tanggal),
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
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ================================================
// CETAK LAPORAN
// ================================================
bind('printBtn', 'click', () => {
  const month = $('monthFilter')?.value || currentMonth();
  const rows = transactions.filter(item =>
    normalizeDate(item.tanggal).slice(0, 7) === month
  );

  const income = rows
    .filter(item => item.jenis === 'Pemasukan')
    .reduce((sum, item) => sum + Number(item.jumlah || 0), 0);

  const expense = rows
    .filter(item => item.jenis === 'Pengeluaran')
    .reduce((sum, item) => sum + Number(item.jumlah || 0), 0);

  const win = window.open('', '_blank');

  if (!win) {
    showToast('Izinkan pop-up untuk mencetak laporan.');
    return;
  }

  win.document.write(`
    <!doctype html>
    <html lang="id">
    <head>
      <meta charset="utf-8">
      <title>Laporan Kas ${escapeHtml(month)}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#222}
        h1,h2,p{text-align:center}
        table{border-collapse:collapse;width:100%;margin-top:20px}
        th,td{border:1px solid #999;padding:8px;text-align:left;font-size:12px}
        th{background:#eaf3ed}
      </style>
    </head>
    <body>
      <h1>Majelis Yasinan “AL HIKMAH”</h1>
      <h2>Laporan Kas Pengajian</h2>
      <p>Periode ${escapeHtml(month)}</p>
      <p>Total pemasukan: ${escapeHtml(rupiah(income))}</p>
      <p>Total pengeluaran: ${escapeHtml(rupiah(expense))}</p>
      <p>Saldo periode: ${escapeHtml(rupiah(income - expense))}</p>
      <table>
        <thead><tr><th>No.</th><th>Tanggal</th><th>Jenis</th>
        <th>Kategori</th><th>Keterangan</th><th>Jumlah</th></tr></thead>
        <tbody>
          ${rows.map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(normalizeDate(item.tanggal))}</td>
              <td>${escapeHtml(item.jenis)}</td>
              <td>${escapeHtml(item.kategori)}</td>
              <td>${escapeHtml(item.keterangan)}</td>
              <td>${escapeHtml(rupiah(item.jumlah))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <script>window.onload = () => window.print();<\/script>
    </body>
    </html>
  `);

  win.document.close();
});

// ================================================
// FILTER, TOMBOL, DAN PENGATURAN
// ================================================
['monthFilter', 'typeFilter'].forEach(id => {
  bind(id, 'change', render);
});
bind('searchInput', 'input', render);
bind('refreshBtn', 'click', () => loadData());

document.querySelectorAll('input[name="jenis"]').forEach(element => {
  element.addEventListener('change', setCategories);
});

bind('manageCategoriesBtn', 'click', openCategorySettings);

document.addEventListener('click', event => {
  if (event.target.closest('#manageCategoriesBtn')) {
    openCategorySettings(event);
  }
});

bind('closeCategoryModal', 'click', () => {
  const modal = $('categoryModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
});

bind('categoryModal', 'click', event => {
  if (event.target === $('categoryModal')) {
    $('categoryModal').classList.add('hidden');
    $('categoryModal').setAttribute('aria-hidden', 'true');
  }
});

document.querySelectorAll('input[name="categoryJenis"]').forEach(element => {
  element.addEventListener('change', renderCategorySettings);
});

bind('addCategoryForm', 'submit', event => {
  event.preventDefault();

  const type = selectedCategoryType();
  const input = $('newCategory');
  const name = input?.value.trim();

  if (!name) return;

  if (CATEGORIES[type].some(
    item => item.toLowerCase() === name.toLowerCase()
  )) {
    showToast('Kategori sudah ada.');
    return;
  }

  CATEGORIES[type].push(name);
  saveCategories();

  if (input) input.value = '';
  showToast('Kategori ditambahkan.');
});

bind('categorySettingsList', 'click', event => {
  const saveButton = event.target.closest('[data-category-save]');
  const deleteButton = event.target.closest('[data-category-delete]');
  const type = selectedCategoryType();

  if (saveButton) {
    const index = Number(saveButton.dataset.categorySave);
    const input = $('categorySettingsList').querySelector(
      `[data-category-name="${index}"]`
    );
    const name = input?.value.trim();

    if (!name) {
      showToast('Nama kategori tidak boleh kosong.');
      return;
    }

    if (CATEGORIES[type].some(
      (item, i) => i !== index &&
        item.toLowerCase() === name.toLowerCase()
    )) {
      showToast('Nama kategori sudah digunakan.');
      return;
    }

    CATEGORIES[type][index] = name;
    saveCategories();
    showToast('Kategori diperbarui.');
  }

  if (deleteButton) {
    const index = Number(deleteButton.dataset.categoryDelete);
    const name = CATEGORIES[type][index];

    if (!confirm(`Hapus kategori "${name}"? Transaksi lama tidak dihapus.`)) {
      return;
    }

    CATEGORIES[type].splice(index, 1);
    saveCategories();
    showToast('Kategori dihapus.');
  }
});

bind('jumlah', 'input', event => {
  const input = event.target;
  const digits = input.value.replace(/\D/g, '');
  input.value = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
});

// ================================================
// TANGGAL, INSTALASI, DAN SINKRONISASI
// ================================================
if ($('tanggal')) $('tanggal').value = localDateString();

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

window.addEventListener('pageshow', () => {
  loadData({ automatic: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadData({ automatic: true });
  }
});

setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadData({ automatic: true });
  }
}, 30000);

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if ($('installBtn')) $('installBtn').classList.remove('hidden');
});

bind('installBtn', 'click', async () => {
  if (!installPrompt) return;

  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;

  if ($('installBtn')) $('installBtn').classList.add('hidden');
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.error('Service worker gagal didaftarkan:', error);
    });
  });
}

// Muat data saat file selesai dijalankan.
loadData();
```
