// ============================================
// APLIKASI KAS PENGAJIAN AL HIKMAH
// app.js - tambah, edit, hapus transaksi
// ============================================

const API_URL = 'https://script.google.com/macros/s/AKfycbxZwOHMoFxSI644jOZYhmvGiLYwHbXv7EnABBG1jazTOvV54ZMR39fPRHeOXTMBtZq_FA/exec';
const DEFAULT_CATEGORIES = {
  Pemasukan: ['Iuran jamaah', 'Donasi', 'Infak', 'Sedekah', 'Sumbangan', 'Lainnya'],
  Pengeluaran: ['Konsumsi', 'Transportasi', 'Perlengkapan', 'Kegiatan pengajian', 'Listrik/Air', 'Santunan', 'Lainnya']
};

const $ = id => document.getElementById(id);
let transactions = [];
let CATEGORIES = readCategories();
let installPrompt = null;
let apiRequestNumber = 0;
let postRequestNumber = 0;
let editingTransactionId = null;
let pendingAction = null;

function readCategories() {
  try {
    const value = JSON.parse(localStorage.getItem('kasPengajianCategories') || 'null');
    if (value && Array.isArray(value.Pemasukan) && Array.isArray(value.Pengeluaran)) return value;
  } catch (error) { console.warn('Kategori lokal tidak dapat dibaca:', error); }
  return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}
function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}
function currentMonth() { return localDateString().slice(0, 7); }
function rupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}
function apiReady() {
  return API_URL.startsWith('https://script.google.com/macros/s/') && API_URL.endsWith('/exec');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatThousands(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
}
function amountNumber(value) { return Number(String(value || '').replace(/\./g, '').replace(/\D/g, '')) || 0; }
function showToast(message) {
  const element = $('toast');
  if (!element) { console.log(message); return; }
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => element.classList.remove('show'), 3000);
}
function setButtonState(id, disabled, text) {
  const button = $(id);
  if (!button) return;
  button.disabled = disabled;
  if (text !== undefined) button.textContent = text;
}

// KATEGORI
function setCategories() {
  const selected = document.querySelector('input[name="jenis"]:checked');
  const select = $('kategori');
  if (!select) return;
  const type = selected ? selected.value : 'Pemasukan';
  const oldValue = select.value;
  const categories = CATEGORIES[type] || [];
  select.innerHTML = categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  if (categories.includes(oldValue)) select.value = oldValue;
}
function saveCategories() {
  try { localStorage.setItem('kasPengajianCategories', JSON.stringify(CATEGORIES)); }
  catch (error) { console.error('Gagal menyimpan kategori:', error); showToast('Kategori tidak dapat disimpan di perangkat.'); }
  setCategories(); renderCategorySettings();
}
function selectedCategoryType() {
  const selected = document.querySelector('input[name="categoryJenis"]:checked');
  return selected ? selected.value : 'Pemasukan';
}
function renderCategorySettings() {
  const container = $('categorySettingsList');
  if (!container) return;
  const categories = CATEGORIES[selectedCategoryType()] || [];
  container.innerHTML = categories.map((name, index) => `
    <div class="category-setting-row">
      <input aria-label="Nama kategori" data-category-name="${index}" value="${escapeHtml(name)}" maxlength="60">
      <button type="button" class="secondary smallbtn" data-category-save="${index}">Simpan</button>
      <button type="button" class="dangerbtn smallbtn" data-category-delete="${index}">Hapus</button>
    </div>`).join('') || '<div class="empty">Belum ada kategori. Tambahkan kategori baru di atas.</div>';
}
function openCategorySettings(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const modal = $('categoryModal');
  if (!modal) { showToast('Panel pengaturan kategori tidak ditemukan.'); return; }
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); renderCategorySettings();
}
function closeCategorySettings() {
  const modal = $('categoryModal');
  if (!modal) return;
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true');
}

// MUAT DATA DARI GOOGLE SHEETS MELALUI JSONP
function loadData() {
  const list = $('transactionList');
  if (!list) { console.error('Elemen transactionList tidak ditemukan.'); return; }
  if (!apiReady()) { list.innerHTML = '<div class="empty">URL Apps Script belum diatur dengan benar.</div>'; return; }
  const requestNumber = ++apiRequestNumber;
  const oldScript = $('apiJsonp'); if (oldScript) oldScript.remove();
  if (window.kasApiTimeout) { clearTimeout(window.kasApiTimeout); window.kasApiTimeout = null; }
  list.innerHTML = '<div class="empty">Memuat data dari Google Sheets...</div>';
  const callback = 'receiveSheetData';
  let selesai = false;
  function bersihkan() {
    if (selesai) return; selesai = true;
    if (window.kasApiTimeout) { clearTimeout(window.kasApiTimeout); window.kasApiTimeout = null; }
    const script = $('apiJsonp'); if (script) script.remove();
    if (window[callback] === callbackHandler) { try { delete window[callback]; } catch (_) { window[callback] = undefined; } }
  }
  function callbackHandler(result) {
    if (selesai || requestNumber !== apiRequestNumber) return;
    bersihkan();
    if (!result || result.ok !== true || !Array.isArray(result.data)) {
      console.error('Respons API tidak valid:', result);
      list.innerHTML = '<div class="empty">Data gagal dibaca dari Google Sheets. Tekan Muat Ulang.</div>'; return;
    }
    try {
      transactions = result.data.map(item => ({
        id: String(item.id || ''), tanggal: String(item.tanggal || ''), jenis: String(item.jenis || ''),
        kategori: String(item.kategori || ''), keterangan: String(item.keterangan || ''), jumlah: Number(item.jumlah) || 0
      }));
      console.log('Berhasil memuat', transactions.length, 'transaksi dari Google Sheets.');
      render();
    } catch (error) {
      console.error('Gagal menampilkan data:', error);
      list.innerHTML = '<div class="empty">Data diterima, tetapi gagal ditampilkan.</div>';
    }
  }
  window[callback] = callbackHandler;
  const script = document.createElement('script'); script.id = 'apiJsonp'; script.async = true;
  script.onerror = function () {
    if (selesai || requestNumber !== apiRequestNumber) return;
    bersihkan(); console.error('Gagal menghubungi Google Apps Script.');
    list.innerHTML = '<div class="empty">Gagal mengambil data. Periksa koneksi internet, lalu tekan Muat Ulang.</div>';
  };
  window.kasApiTimeout = setTimeout(() => {
    if (selesai || requestNumber !== apiRequestNumber) return;
    bersihkan(); console.error('Permintaan API melewati batas waktu.');
    list.innerHTML = '<div class="empty">Server terlalu lama merespons. Periksa koneksi lalu tekan Muat Ulang.</div>';
  }, 30000);
  script.src = API_URL + '?callback=' + encodeURIComponent(callback) + '&t=' + Date.now();
  document.head.appendChild(script);
}

// RENDER TRANSAKSI, SALDO, FILTER
function render() {
  const month = $('monthFilter') ? ($('monthFilter').value || currentMonth()) : currentMonth();
  const type = $('typeFilter') ? $('typeFilter').value : '';
  const query = $('searchInput') ? $('searchInput').value.trim().toLowerCase() : '';
  const monthRows = transactions.filter(item => String(item.tanggal || '').slice(0, 7) === month);
  const totalMasuk = transactions.filter(item => item.jenis === 'Pemasukan').reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);
  const totalKeluar = transactions.filter(item => item.jenis === 'Pengeluaran').reduce((sum, item) => sum + (Number(item.jumlah) || 0), 0);
  if ($('saldo')) $('saldo').textContent = rupiah(totalMasuk - totalKeluar);
  if ($('pemasukan')) $('pemasukan').textContent = rupiah(totalMasuk);
  if ($('pengeluaran')) $('pengeluaran').textContent = rupiah(totalKeluar);
  if ($('jumlahTransaksi')) $('jumlahTransaksi').textContent = `${transactions.length} transaksi keseluruhan`;
  if ($('historySubtitle')) $('historySubtitle').textContent = `Bulan ${month}`;
  const rows = monthRows.filter(item => (!type || item.jenis === type) && `${item.kategori || ''} ${item.keterangan || ''} ${item.tanggal || ''}`.toLowerCase().includes(query));
  const list = $('transactionList'); if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${monthRows.length ? 'Tidak ada transaksi yang cocok dengan filter atau pencarian.' : 'Belum ada transaksi pada bulan ini.'}</div>`; return;
  }
  list.innerHTML = rows.map(item => {
    const income = item.jenis === 'Pemasukan';
    return `<article class="transaction">
      <div class="txicon ${income ? 'in' : 'out'}">${income ? '↗' : '↘'}</div>
      <div class="txdetails"><strong>${escapeHtml(item.kategori)}</strong><small>${escapeHtml(item.tanggal)}${item.keterangan ? ' · ' + escapeHtml(item.keterangan) : ''}</small></div>
      <div class="txright"><div class="txamount ${income ? 'in' : 'out'}">${income ? '+' : '−'}${rupiah(item.jumlah)}</div>
        <div class="txactions">
          <button type="button" class="secondary smallbtn" data-edit="${escapeHtml(item.id)}">Edit</button>
          <button type="button" class="deletebtn smallbtn" data-delete="${escapeHtml(item.id)}">Hapus</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

// FORM EDIT
function resetTransactionForm() {
  editingTransactionId = null;
  const form = $('transactionForm'); if (form) form.reset();
  if ($('tanggal')) $('tanggal').value = localDateString();
  setCategories();
  setButtonState('saveBtn', false, 'Simpan transaksi');
  const cancel = $('cancelEditBtn'); if (cancel) cancel.remove();
}
function startEditingTransaction(item) {
  editingTransactionId = item.id;
  const radio = document.querySelector(`input[name="jenis"][value="${item.jenis}"]`);
  if (radio) radio.checked = true;
  setCategories();
  if ($('tanggal')) $('tanggal').value = item.tanggal;
  if ($('kategori')) {
    if (![...$('kategori').options].some(option => option.value === item.kategori)) {
      const option = document.createElement('option'); option.value = item.kategori; option.textContent = item.kategori; $('kategori').appendChild(option);
    }
    $('kategori').value = item.kategori;
  }
  if ($('keterangan')) $('keterangan').value = item.keterangan;
  if ($('jumlah')) $('jumlah').value = formatThousands(item.jumlah);
  setButtonState('saveBtn', false, 'Simpan perubahan');
  let cancel = $('cancelEditBtn');
  if (!cancel) {
    cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'cancelEditBtn'; cancel.className = 'secondary'; cancel.textContent = 'Batal edit';
    const save = $('saveBtn'); if (save) save.insertAdjacentElement('afterend', cancel);
    cancel.addEventListener('click', resetTransactionForm);
  }
  showToast('Mode edit aktif. Ubah data lalu simpan.');
  $('transactionForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// KIRIM DATA KE GOOGLE SHEETS MELALUI FORM + IFRAME
function ensurePostFrame(form) {
  let frame = $('kasPostFrame');
  if (!frame) { frame = document.createElement('iframe'); frame.id = 'kasPostFrame'; frame.name = 'kasPostFrame'; frame.title = 'Pengiriman data transaksi'; frame.hidden = true; document.body.appendChild(frame); }
  form.target = frame.name; form.method = 'POST'; return frame;
}
function submitPost(data) {
  const form = $('postForm');
  if (!form) { showToast('Form pengiriman tidak ditemukan.'); console.error('Elemen postForm tidak ditemukan.'); return false; }
  form.action = API_URL; ensurePostFrame(form);
  Object.entries(data).forEach(([key, value]) => {
    let input = form.elements.namedItem(key);
    if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = key; form.appendChild(input); }
    input.value = value ?? '';
  });
  postRequestNumber++; form.dataset.requestNumber = String(postRequestNumber);
  try { form.submit(); return true; }
  catch (error) { console.error('Gagal mengirim transaksi:', error); showToast('Transaksi gagal dikirim. Periksa koneksi internet.'); return false; }
}
function handlePostResult(result) {
  const sentAction = pendingAction;
  pendingAction = null;
  if (result.ok) {
    showToast(result.message || 'Transaksi berhasil diproses.');
    if (sentAction === 'add' || sentAction === 'edit') resetTransactionForm();
    loadData();
  } else {
    showToast(result.message || 'Transaksi gagal diproses.');
    console.error('Apps Script menolak permintaan:', result.message);
  }
  setButtonState('saveBtn', false, editingTransactionId ? 'Simpan perubahan' : 'Simpan transaksi');
}
window.addEventListener('message', function(event) {
  const frame = $('kasPostFrame');
  if (!frame || event.source !== frame.contentWindow) return;
  const result = event.data;
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return;
  handlePostResult(result);
});

function handleTransactionSubmit(event) {
  event.preventDefault();
  if (!apiReady()) { showToast('URL Apps Script belum diatur.'); return; }
  const selected = document.querySelector('input[name="jenis"]:checked');
  if (!selected) { showToast('Pilih jenis transaksi.'); return; }
  const tanggal = $('tanggal'), kategori = $('kategori'), keterangan = $('keterangan'), jumlah = $('jumlah');
  if (!tanggal || !kategori || !jumlah) { showToast('Form transaksi belum lengkap.'); return; }
  const action = editingTransactionId ? 'edit' : 'add';
  const data = { action, tanggal: tanggal.value, jenis: selected.value, kategori: kategori.value, keterangan: keterangan ? keterangan.value.trim() : '', jumlah: String(amountNumber(jumlah.value)) };
  if (editingTransactionId) data.id = editingTransactionId;
  if (!data.tanggal || Number(data.jumlah) <= 0) { showToast('Periksa tanggal dan jumlah transaksi.'); return; }
  setButtonState('saveBtn', true, action === 'edit' ? 'Menyimpan perubahan…' : 'Mengirim…');
  pendingAction = action;
  if (!submitPost(data)) { pendingAction = null; setButtonState('saveBtn', false, editingTransactionId ? 'Simpan perubahan' : 'Simpan transaksi'); return; }
  showToast(action === 'edit' ? 'Permintaan perubahan dikirim.' : 'Permintaan penyimpanan dikirim.');
  const requestAtSend = postRequestNumber;
  setTimeout(() => {
    if (postRequestNumber !== requestAtSend || pendingAction !== action) return;
    pendingAction = null;
    setButtonState('saveBtn', false, editingTransactionId ? 'Simpan perubahan' : 'Simpan transaksi');
    // Muat ulang data untuk memeriksa hasil penyimpanan di server.
    loadData();
  }, 7000);
}
function handleTransactionListClick(event) {
  const editButton = event.target.closest('[data-edit]');
  const deleteButton = event.target.closest('[data-delete]');
  if (!editButton && !deleteButton) return;
  const id = editButton ? editButton.dataset.edit : deleteButton.dataset.delete;
  const item = transactions.find(transaction => String(transaction.id) === String(id));
  if (!item) { showToast('Transaksi tidak ditemukan. Muat ulang data.'); return; }
  if (editButton) { startEditingTransaction(item); return; }
  if (deleteButton) {
    if (!confirm(`Hapus transaksi ${item.kategori} sebesar ${rupiah(item.jumlah)}?`)) return;
    deleteButton.disabled = true;
    pendingAction = 'delete';
    if (!submitPost({ action: 'delete', id: item.id })) { pendingAction = null; deleteButton.disabled = false; return; }
    showToast('Permintaan penghapusan dikirim.');
    const requestAtSend = postRequestNumber;
    setTimeout(() => {
      if (postRequestNumber !== requestAtSend || pendingAction !== 'delete') return;
      pendingAction = null; loadData();
    }, 7000);
  }
}

// EKSPOR CSV
function exportCSV() {
  const month = $('monthFilter') ? ($('monthFilter').value || currentMonth()) : currentMonth();
  const rows = transactions.filter(item => String(item.tanggal || '').slice(0, 7) === month);
  if (!rows.length) { showToast('Tidak ada transaksi untuk diekspor.'); return; }
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = '\ufeff' + [['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Jumlah'], ...rows.map(item => [item.tanggal, item.jenis, item.kategori, item.keterangan, item.jumlah])].map(row => row.map(quote).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `kas-pengajian-${month}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CETAK LAPORAN
function printReport() {
  const month = $('monthFilter') ? ($('monthFilter').value || currentMonth()) : currentMonth();
  const type = $('typeFilter') ? $('typeFilter').value : '';
  const query = $('searchInput') ? $('searchInput').value.trim().toLowerCase() : '';
  const rows = transactions.filter(item => String(item.tanggal || '').slice(0, 7) === month && (!type || item.jenis === type) && `${item.kategori || ''} ${item.keterangan || ''} ${item.tanggal || ''}`.toLowerCase().includes(query));
  const masuk = rows.filter(item => item.jenis === 'Pemasukan').reduce((sum, item) => sum + Number(item.jumlah || 0), 0);
  const keluar = rows.filter(item => item.jenis === 'Pengeluaran').reduce((sum, item) => sum + Number(item.jumlah || 0), 0);
  const printWindow = window.open('', '_blank');
  if (!printWindow) { showToast('Izinkan pop-up untuk mencetak laporan.'); return; }
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Laporan Kas Pengajian ${safe(month)}</title><style>body{font-family:Arial,sans-serif;color:#222;padding:24px}h1,h2,.subtitle{text-align:center;margin:6px}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{border:1px solid #999;padding:8px;text-align:left;font-size:12px}th{background:#eaf3ed}.totals{display:flex;gap:20px;flex-wrap:wrap;margin-top:20px;font-weight:bold}.date{text-align:right;font-size:12px;margin-top:18px}@media print{body{padding:0}}</style></head><body><h1>Majelis Yasinan “AL HIKMAH”</h1><h2>Laporan Kas Pengajian</h2><p class="subtitle">Periode ${safe(month)}</p><div class="totals"><span>Total pemasukan: ${safe(rupiah(masuk))}</span><span>Total pengeluaran: ${safe(rupiah(keluar))}</span><span>Selisih periode: ${safe(rupiah(masuk - keluar))}</span></div><table><thead><tr><th>No.</th><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Jumlah</th></tr></thead><tbody>${rows.map((item, index) => `<tr><td>${index + 1}</td><td>${safe(item.tanggal)}</td><td>${safe(item.jenis)}</td><td>${safe(item.kategori)}</td><td>${safe(item.keterangan)}</td><td>${safe(rupiah(item.jumlah))}</td></tr>`).join('')}</tbody></table><p class="date">Dicetak: ${safe(new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(new Date()))}</p><script>window.onload=()=>window.print();<\/script></body></html>`);
  printWindow.document.close();
}

// INSTALASI PWA
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    if ($('installBtn')) $('installBtn').classList.remove('hidden');
  });
  const installButton = $('installBtn'); if (!installButton) return;
  installButton.addEventListener('click', async () => {
    if (!installPrompt) { showToast('Gunakan menu browser lalu pilih Tambahkan ke layar utama jika tersedia.'); return; }
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (error) { console.warn('Pilihan instalasi tidak dapat dibaca:', error); }
    installPrompt = null; installButton.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null; if (installButton) installButton.classList.add('hidden'); showToast('Aplikasi berhasil dipasang.');
  });
}

// INISIALISASI
function initApp() {
  const transactionForm = $('transactionForm');
  if (transactionForm) transactionForm.addEventListener('submit', handleTransactionSubmit);
  else console.error('Elemen transactionForm tidak ditemukan.');
  const postForm = $('postForm'); if (postForm) postForm.method = 'POST'; else console.error('Elemen postForm tidak ditemukan.');
  const transactionList = $('transactionList'); if (transactionList) transactionList.addEventListener('click', handleTransactionListClick);
  document.querySelectorAll('input[name="jenis"]').forEach(element => element.addEventListener('change', setCategories));
  ['monthFilter', 'typeFilter', 'searchInput'].forEach(id => {
    const element = $(id); if (!element) return;
    element.addEventListener(id === 'searchInput' ? 'input' : 'change', render);
  });
  if ($('refreshBtn')) $('refreshBtn').addEventListener('click', loadData);
  if ($('exportBtn')) $('exportBtn').addEventListener('click', exportCSV);
  if ($('printBtn')) $('printBtn').addEventListener('click', printReport);
  if ($('manageCategoriesBtn')) $('manageCategoriesBtn').addEventListener('click', openCategorySettings);
  if ($('closeCategoryModal')) $('closeCategoryModal').addEventListener('click', closeCategorySettings);
  if ($('categoryModal')) $('categoryModal').addEventListener('click', event => { if (event.target === $('categoryModal')) closeCategorySettings(); });
  document.querySelectorAll('input[name="categoryJenis"]').forEach(element => element.addEventListener('change', renderCategorySettings));
  if ($('addCategoryForm')) $('addCategoryForm').addEventListener('submit', event => {
    event.preventDefault(); const type = selectedCategoryType(); const input = $('newCategory'); const name = input ? input.value.trim() : '';
    if (!name) { showToast('Masukkan nama kategori.'); return; }
    if (!CATEGORIES[type]) CATEGORIES[type] = [];
    if (CATEGORIES[type].some(category => category.toLowerCase() === name.toLowerCase())) { showToast('Kategori tersebut sudah ada.'); return; }
    CATEGORIES[type].push(name); saveCategories(); if (input) input.value = ''; showToast('Kategori berhasil ditambahkan.');
  });
  if ($('categorySettingsList')) $('categorySettingsList').addEventListener('click', event => {
    const saveButton = event.target.closest('[data-category-save]'); const deleteButton = event.target.closest('[data-category-delete]'); const type = selectedCategoryType(); if (!CATEGORIES[type]) return;
    if (saveButton) {
      const index = Number(saveButton.dataset.categorySave); const input = $('categorySettingsList').querySelector(`[data-category-name="${index}"]`); if (!input) return;
      const name = input.value.trim(); if (!name) { showToast('Nama kategori tidak boleh kosong.'); return; }
      if (CATEGORIES[type].some((category, i) => i !== index && category.toLowerCase() === name.toLowerCase())) { showToast('Nama kategori sudah digunakan.'); return; }
      CATEGORIES[type][index] = name; saveCategories(); showToast('Kategori berhasil diubah.');
    }
    if (deleteButton) {
      const index = Number(deleteButton.dataset.categoryDelete); const name = CATEGORIES[type][index]; if (name === undefined) return;
      if (!confirm(`Hapus kategori "${name}" dari daftar? Transaksi lama tidak dihapus.`)) return;
      CATEGORIES[type].splice(index, 1); saveCategories(); showToast('Kategori berhasil dihapus.');
    }
  });
  if ($('jumlah')) $('jumlah').addEventListener('input', () => {
    const input = $('jumlah'); const oldPosition = input.selectionStart; const oldLength = input.value.length; input.value = formatThousands(input.value);
    const newPosition = Math.max(0, (oldPosition || 0) + input.value.length - oldLength);
    try { input.setSelectionRange(newPosition, newPosition); } catch (_) {}
  });
  if ($('tanggal')) $('tanggal').value = localDateString();
  if ($('todayDate')) $('todayDate').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  if ($('monthFilter') && !$('monthFilter').value) $('monthFilter').value = currentMonth();
  setCategories(); renderCategorySettings(); setupInstallPrompt(); loadData();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.error('Service Worker gagal didaftarkan:', error)));
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp, { once: true });
else initApp();
