
'use strict';

/* =========================================
   KAS PENGAJIAN AL HIKMAH
   app.js - versi pengganti
   ========================================= */

var API_URL = 'https://script.google.com/macros/s/AKfycbyJaQJus17QR3NEcshSfZbeQD8bdlAYGmN0ve0wN6vpormHesQLNouTwWsnn8qBnfpyVA/exec';

var transaksi = [];
var sedangMemuat = false;

function cariElemen(daftarId) {
  for (var i = 0; i < daftarId.length; i++) {
    var elemen = document.getElementById(daftarId[i]);
    if (elemen) return elemen;
  }
  return null;
}

function ubahTeks(daftarId, teks) {
  var elemen = cariElemen(daftarId);
  if (elemen) elemen.textContent = teks;
}

function rupiah(nilai) {
  var angka = Number(nilai);
  if (!Number.isFinite(angka)) angka = 0;

  return 'Rp ' + angka.toLocaleString('id-ID');
}

function angkaUang(nilai) {
  if (typeof nilai === 'number') return nilai;

  var teks = String(nilai == null ? '' : nilai).trim();
  teks = teks.replace(/rp/gi, '').replace(/\s/g, '');

  if (teks.indexOf('.') !== -1 && teks.indexOf(',') !== -1) {
    teks = teks.replace(/\./g, '').replace(',', '.');
  } else if (teks.indexOf('.') !== -1) {
    teks = teks.replace(/\./g, '');
  } else if (teks.indexOf(',') !== -1) {
    teks = teks.replace(',', '.');
  }

  var hasil = Number(teks);
  return Number.isFinite(hasil) ? hasil : 0;
}

function tanggalHariIni(tanggal) {
  var tahun = tanggal.getFullYear();
  var bulan = String(tanggal.getMonth() + 1);
  var hari = String(tanggal.getDate());

  if (bulan.length < 2) bulan = '0' + bulan;
  if (hari.length < 2) hari = '0' + hari;

  return tahun + '-' + bulan + '-' + hari;
}

function normalisasiTanggal(nilai) {
  if (nilai == null || nilai === '') return '';

  if (nilai instanceof Date && !isNaN(nilai.getTime())) {
    return tanggalHariIni(nilai);
  }

  var teks = String(nilai).trim();
  if (!teks) return '';

  var cocok = teks.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (cocok) {
    return cocok[1] + '-' +
      String(cocok[2]).padStart(2, '0') + '-' +
      String(cocok[3]).padStart(2, '0');
  }

  cocok = teks.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (cocok) {
    return cocok[3] + '-' +
      String(cocok[2]).padStart(2, '0') + '-' +
      String(cocok[1]).padStart(2, '0');
  }

  var tanggal = new Date(teks);
  if (!isNaN(tanggal.getTime())) return tanggalHariIni(tanggal);

  return '';
}

function nilaiKolom(data, nama) {
  var kunci = nama.toLowerCase();

  for (var key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      if (key.toLowerCase() === kunci) return data[key];
    }
  }

  return '';
}

function normalisasiTransaksi(data) {
  return data.map(function (item, indeks) {
    var tanggal = nilaiKolom(item, 'tanggal');
    var jenis = String(nilaiKolom(item, 'jenis') || '').toLowerCase().trim();

    if (jenis === 'masuk') jenis = 'pemasukan';
    if (jenis === 'keluar') jenis = 'pengeluaran';

    return {
      id: nilaiKolom(item, 'id') || String(indeks + 1),
      tanggal: normalisasiTanggal(tanggal),
      jenis: jenis,
      kategori: nilaiKolom(item, 'kategori') || '-',
      keterangan: nilaiKolom(item, 'keterangan') || '-',
      jumlah: angkaUang(nilaiKolom(item, 'jumlah'))
    };
  });
}

function bulanTerpilih() {
  var elemen = cariElemen([
    'filterBulan', 'bulanFilter', 'filter-bulan',
    'bulan', 'monthFilter'
  ]);

  if (elemen && elemen.value) {
    var nilai = elemen.value;

    if (/^\d{4}-\d{2}$/.test(nilai)) return nilai;
    if (/^\d{4}-\d{2}-\d{2}$/.test(nilai)) {
      return nilai.substring(0, 7);
    }
  }

  var sekarang = new Date();
  return sekarang.getFullYear() + '-' +
    String(sekarang.getMonth() + 1).padStart(2, '0');
}

function transaksiBulanIni() {
  var bulan = bulanTerpilih();

  return transaksi.filter(function (item) {
    return item.tanggal && item.tanggal.substring(0, 7) === bulan;
  });
}

function hitungRingkasan() {
  var data = transaksiBulanIni();
  var pemasukan = 0;
  var pengeluaran = 0;

  data.forEach(function (item) {
    if (item.jenis.indexOf('masuk') !== -1 ||
        item.jenis.indexOf('pemasukan') !== -1) {
      pemasukan += item.jumlah;
    } else if (item.jenis.indexOf('keluar') !== -1 ||
               item.jenis.indexOf('pengeluaran') !== -1) {
      pengeluaran += item.jumlah;
    }
  });

  ubahTeks([
    'totalPemasukan', 'totalMasuk', 'pemasukan',
    'total-pemasukan', 'income'
  ], rupiah(pemasukan));

  ubahTeks([
    'totalPengeluaran', 'totalKeluar', 'pengeluaran',
    'total-pengeluaran', 'expense'
  ], rupiah(pengeluaran));

  ubahTeks([
    'saldo', 'totalSaldo', 'saldoKas',
    'totalSaldoKas', 'total-saldo', 'balance'
  ], rupiah(pemasukan - pengeluaran));

  ubahTeks([
    'jumlahTransaksi', 'totalTransaksi',
    'jumlah-transaksi', 'transactionCount'
  ], String(data.length));

  tampilkanTabel(data);
}

function tampilkanTabel(data) {
  var tabel = cariElemen([
    'tabelTransaksi', 'daftarTransaksi',
    'transaksiBody', 'tbodyTransaksi',
    'dataTransaksi', 'transactionList'
  ]);

  if (!tabel) return;

  tabel.innerHTML = '';

  if (!data.length) {
    var barisKosong = document.createElement('tr');
    var kolomKosong = document.createElement('td');

    kolomKosong.colSpan = 5;
    kolomKosong.textContent = 'Belum ada transaksi pada bulan ini.';
    barisKosong.appendChild(kolomKosong);
    tabel.appendChild(barisKosong);
    return;
  }

  data.slice().reverse().forEach(function (item) {
    var baris = document.createElement('tr');

    [
      item.tanggal,
      item.jenis,
      item.kategori,
      item.keterangan,
      rupiah(item.jumlah)
    ].forEach(function (nilai) {
      var kolom = document.createElement('td');
      kolom.textContent = nilai;
      baris.appendChild(kolom);
    });

    tabel.appendChild(baris);
  });
}

function tampilkanStatus(pesan) {
  ubahTeks([
    'statusKoneksi', 'status', 'pesanStatus',
    'statusAPI', 'connectionStatus'
  ], pesan);
}

function muatData() {
  if (sedangMemuat) return;
  sedangMemuat = true;
  tampilkanStatus('Menghubungkan ke Google Sheets...');

  var pemisah = API_URL.indexOf('?') >= 0 ? '&' : '?';
  var url = API_URL + pemisah +
    'action=api&_=' + new Date().getTime();

  var selesai = false;
  var namaCallback = 'kasCallback' + Date.now();

  function beres() {
    sedangMemuat = false;
  }

  function berhasil(json) {
    if (selesai) return;
    selesai = true;

    try {
      if (json && json.ok === false) {
        throw new Error(json.message || 'API melaporkan kegagalan.');
      }

      var daftar = Array.isArray(json) ? json :
        (json && Array.isArray(json.data) ? json.data : null);

      if (!daftar) {
        throw new Error('Format data API tidak sesuai.');
      }

      transaksi = normalisasiTransaksi(daftar);
      hitungRingkasan();
      tampilkanStatus('Data berhasil dimuat: ' + transaksi.length + ' transaksi.');
    } catch (error) {
      tampilkanStatus('Gagal membaca data: ' + error.message);
      console.error(error);
    }

    beres();
  }

  // JSONP untuk menghindari kendala CORS Google Apps Script.
  window[namaCallback] = berhasil;

  var script = document.createElement('script');
  script.src = url + '&callback=' + namaCallback;
  script.async = true;

  script.onerror = function () {
    if (selesai) return;
    selesai = true;
    tampilkanStatus('Koneksi gagal. Periksa URL dan izin deployment Apps Script.');
    beres();
    bersihkan();
  };

  function bersihkan() {
    try {
      delete window[namaCallback];
    } catch (e) {
      window[namaCallback] = undefined;
    }

    if (script.parentNode) script.parentNode.removeChild(script);
  }

  window[namaCallback] = function (hasil) {
    berhasil(hasil);
    bersihkan();
  };

  document.head.appendChild(script);

  // Fallback JSONP jika API mengembalikan JSON biasa.
  // Batas waktu untuk mencegah status loading terus-menerus.
  window.setTimeout(function () {
    if (!selesai) {
      selesai = true;
      tampilkanStatus('Belum ada respons API. Periksa deployment Apps Script.');
      beres();
      bersihkan();
    }
  }, 20000);
}

function pasangEvent() {
  var tombolMuat = cariElemen([
    'btnRefresh', 'refreshBtn', 'tombolMuatUlang',
    'muatUlang', 'refresh'
  ]);

  if (tombolMuat) {
    tombolMuat.addEventListener('click', function (event) {
      event.preventDefault();
      muatData();
    });
  }

  var filter = cariElemen([
    'filterBulan', 'bulanFilter', 'filter-bulan',
    'bulan', 'monthFilter'
  ]);

  if (filter) {
    filter.addEventListener('change', hitungRingkasan);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  pasangEvent();
  muatData();
});
```
