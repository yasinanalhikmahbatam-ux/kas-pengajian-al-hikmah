```javascript
'use strict';

/* =========================================================
   KAS PENGAJIAN AL-HIKMAH BATAM
   app.js — versi perbaikan
   Data: Google Sheets melalui Apps Script JSONP
   ========================================================= */

const API_URL =
  'https://script.google.com/macros/s/AKfycbyJaQJus17QR3NEcshSfZbeQD8bdlAYGmN0ve0wN6vpormHesQLNouTwWsnn8qBnfpyVA/exec';

const APP = {
  data: [],
  loading: false,
  lastLoaded: 0,
  requestTimeout: null,
  retryTimer: null,
  selectedMonth: 'all',
  jsonpCallback: null
};

const $ = (id) => document.getElementById(id);

function rupiah(value) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

function numberValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value ?? '').trim();
  text = text.replace(/Rp/gi, '').replace(/\s/g, '');

  if (!text) return 0;

  // Format Indonesia, misalnya 1.500.000
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+,\d+$/.test(text)) {
    text = text.replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  const result = Number(text);
  return Number.isFinite(result) ? result : 0;
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function normalizeDate(value) {
  const text = String(value ?? '').trim();

  if (!text) return '';

  // YYYY-MM-DD atau tanggal yang memiliki bagian waktu
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY atau DD-MM-YYYY
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  // Format tanggal dari Google Sheets berupa tanggal lengkap
  const date = new Date(text);

  if (!Number.isNaN(date.getTime())) {
    return localDateString(date);
  }

  return text;
}

function formatDate(value) {
  const normalized = normalizeDate(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return normalized || '-';

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  ).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function normalizeType(value) {
  const text = String(value ?? '').trim().toLowerCase();

  if (
    text.includes('keluar') ||
    text.includes('pengeluaran') ||
    text.includes('belanja') ||
    text.includes('expense')
  ) {
    return 'keluar';
  }

  return 'masuk';
}

function normalizeTransaction(row, index) {
  row = row || {};

  const date = normalizeDate(
    row.tanggal ?? row.tgl ?? row.date ?? ''
  );

  const rawType = row.jenis ?? row.tipe ?? row.type ?? 'masuk';

  return {
    id: String(row.id ?? `${date}-${index}`),
    tanggal: date,
    jenis: normalizeType(rawType),
    kategori: String(row.kategori ?? row.category ?? '-'),
    keterangan: String(
      row.keterangan ?? row.deskripsi ?? row.description ?? ''
    ),
    jumlah: numberValue(
      row.jumlah ?? row.nominal ?? row.amount ?? 0
    ),
    dibuatPada: row.dibuatPada ?? ''
  };
}

function showToast(message, type = 'info') {
  let toast = $('toast');

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');

    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      maxWidth: '90%',
      padding: '12px 18px',
      borderRadius: '10px',
      color: '#fff',
      background: '#176b45',
      boxShadow: '0 4px 18px rgba(0,0,0,.2)',
      fontSize: '14px',
      textAlign: 'center',
      display: 'none'
    });

    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background =
    type === 'error' ? '#b42318' :
    type === 'success' ? '#176b45' : '#333';
  toast.style.display = 'block';

  clearTimeout(APP.toastTimer);

  APP.toastTimer = setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function getMonthKey(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.slice(0, 7)
    : '';
}

function getFilteredData() {
  if (APP.selectedMonth === 'all') {
    return APP.data.slice();
  }

  return APP.data.filter((item) => {
    return getMonthKey(item.tanggal) === APP.selectedMonth;
  });
}

function updateMonthFilter() {
  const select = $('monthFilter');
  if (!select) return;

  const previousValue = APP.selectedMonth;
  const months = [...new Set(
    APP.data.map((item) => getMonthKey(item.tanggal)).filter(Boolean)
  )].sort().reverse();

  select.innerHTML = [
    '<option value="all">Semua Bulan</option>',
    ...months.map((month) => {
      const [year, monthNumber] = month.split('-');
      const label = new Date(
        Number(year),
        Number(monthNumber) - 1,
        1
      ).toLocaleDateString('id-ID', {
        month: 'long',
        year: 'numeric'
      });

      return `<option value="${month}">${escapeHTML(label)}</option>`;
    })
  ].join('');

  if (
    previousValue === 'all' ||
    months.includes(previousValue)
  ) {
    select.value = previousValue;
  } else {
    select.value = 'all';
    APP.selectedMonth = 'all';
  }
}

function renderSummary(items) {
  let income = 0;
  let expense = 0;

  for (const item of items) {
    if (item.jenis === 'keluar') {
      expense += item.jumlah;
    } else {
      income += item.jumlah;
    }
  }

  setText('saldo', rupiah(income - expense));
  setText('pemasukan', rupiah(income));
  setText('pengeluaran', rupiah(expense));
  setText('jumlahTransaksi', String(items.length));

  // Mendukung beberapa variasi ID pada HTML
  setText('totalSaldo', rupiah(income - expense));
  setText('totalPemasukan', rupiah(income));
  setText('totalPengeluaran', rupiah(expense));
  setText('totalTransaksi', String(items.length));
}

function renderTransactions(items) {
  const container = $('transactionList');

  if (!container) {
    console.warn(
      'Elemen #transactionList tidak ditemukan. Periksa index.html.'
    );
    return;
  }

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:28px 16px;text-align:center">
        <p style="margin:0 0 6px;font-weight:600">
          Belum ada data kehadiran atau transaksi.
        </p>
        <p style="margin:0;color:#777;font-size:14px">
          Data akan muncul setelah berhasil dimuat dari Google Sheets.
        </p>
      </div>
    `;
    return;
  }

  const sorted = items.slice().sort((a, b) => {
    const dateCompare = b.tanggal.localeCompare(a.tanggal);
    if (dateCompare !== 0) return dateCompare;

    return String(b.id).localeCompare(String(a.id));
  });

  container.innerHTML = sorted.map((item) => {
    const isExpense = item.jenis === 'keluar';
    const typeLabel = isExpense ? 'Pengeluaran' : 'Pemasukan';
    const amountPrefix = isExpense ? '− ' : '+ ';

    return `
      <div class="transaction-item" style="padding:14px 12px;border-bottom:1px solid #eee">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div style="min-width:0;flex:1">
            <div style="font-weight:600;overflow-wrap:anywhere">
              ${escapeHTML(item.keterangan || item.kategori || typeLabel)}
            </div>
            <div style="font-size:13px;color:#777;margin-top:5px">
              ${escapeHTML(formatDate(item.tanggal))}
              · ${escapeHTML(item.kategori)}
            </div>
            <div style="font-size:12px;margin-top:5px;color:${isExpense ? '#b42318' : '#176b45'}">
              ${typeLabel}
            </div>
          </div>
          <div style="font-weight:700;text-align:right;white-space:nowrap;color:${isExpense ? '#b42318' : '#176b45'}">
            ${amountPrefix}${escapeHTML(rupiah(item.jumlah))}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function render() {
  const items = getFilteredData();

  renderSummary(items);
  renderTransactions(items);
}

function setLoading(isLoading) {
  APP.loading = isLoading;

  const indicator = $('loading');
  if (indicator) {
    indicator.style.display = isLoading ? 'block' : 'none';
  }

  const refreshButton = $('refreshButton');
  if (refreshButton) {
    refreshButton.disabled = isLoading;
    refreshButton.textContent = isLoading ? 'Memuat...' : 'Muat Ulang';
  }
}

function loadData(options = {}) {
  const force = options.force === true;

  if (APP.loading && !force) return;

  if (!API_URL || !API_URL.includes('/exec')) {
    showToast('URL Google Apps Script belum benar.', 'error');
    return;
  }

  setLoading(true);

  if (APP.jsonpCallback && window[APP.jsonpCallback]) {
    try {
      delete window[APP.jsonpCallback];
    } catch (_) {
      window[APP.jsonpCallback] = undefined;
    }
  }

  const callbackName =
    'kasAlHikmahCallback_' + Date.now() + '_' +
    Math.random().toString(36).slice(2, 8);

  APP.jsonpCallback = callbackName;

  const script = document.createElement('script');
  let completed = false;

  function cleanup() {
    clearTimeout(APP.requestTimeout);
    script.remove();

    try {
      delete window[callbackName];
    } catch (_) {
      window[callbackName] = undefined;
    }

    if (APP.jsonpCallback === callbackName) {
      APP.jsonpCallback = null;
    }
  }

  window[callbackName] = function (response) {
    if (completed) return;
    completed = true;

    cleanup();
    setLoading(false);

    if (!response || response.ok !== true || !Array.isArray(response.data)) {
      console.error('Respons API tidak sesuai:', response);
      showToast(
        response && response.message
          ? response.message
          : 'Data dari Google Sheets tidak dapat dibaca.',
        'error'
      );
      return;
    }

    APP.data = response.data.map(normalizeTransaction);
    APP.lastLoaded = Date.now();

    updateMonthFilter();
    render();

    console.log(
      'Data Kas Al-Hikmah berhasil dimuat:',
      APP.data.length,
      'transaksi'
    );
  };

  script.onerror = function () {
    if (completed) return;
    completed = true;

    cleanup();
    setLoading(false);

    console.error('Gagal memuat API Google Apps Script.');
    showToast(
      'Gagal terhubung ke Google Sheets. Periksa URL dan deployment Apps Script.',
      'error'
    );
  };

  const separator = API_URL.includes('?') ? '&' : '?';

  script.src =
    API_URL + separator +
    'action=api' +
    '&callback=' + encodeURIComponent(callbackName) +
    '&_=' + Date.now();

  APP.requestTimeout = setTimeout(() => {
    if (completed) return;
    completed = true;

    cleanup();
    setLoading(false);

    showToast(
      'Permintaan data terlalu lama. Silakan tekan Muat Ulang.',
      'error'
    );
  }, 20000);

  document.head.appendChild(script);
}

function bindEvents() {
  const monthFilter = $('monthFilter');

  if (monthFilter) {
    monthFilter.addEventListener('change', () => {
      APP.selectedMonth = monthFilter.value || 'all';
      render();
    });
  }

  const refreshButton = $('refreshButton');

  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      loadData({ force: true });
    });
  }

  // Mendukung tombol yang menggunakan onclick="loadData()"
  window.loadData = loadData;
  window.render = render;
  window.showToast = showToast;
  window.rupiah = rupiah;
}

function initializeApp() {
  bindEvents();

  // Tampilkan kondisi awal yang jelas, bukan angka kosong.
  const container = $('transactionList');

  if (container && APP.data.length === 0) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:#777">
        Menghubungkan ke Google Sheets...
      </div>
    `;
  }

  loadData();

  // Perbarui data berkala tanpa membuat banyak permintaan bersamaan.
  setInterval(() => {
    if (!document.hidden && !APP.loading) {
      loadData();
    }
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !APP.loading) {
      loadData();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, {
    once: true
  });
} else {
  initializeApp();
}
```
