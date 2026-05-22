import { addFuelup, getAllFuelups, deleteFuelup, getDaysSinceLastExport, markExportDone } from './db.js';
import { calculateConsumption, getAverageConsumption, getTotalSpent, getTotalLiters, getTotalDistance, getCostPerKm } from './stats.js';
import { exportData, importData } from './backup.js';
import { scanImage } from './ocr.js';

// DOM elements
const views = document.querySelectorAll('.view');
const navBtns = document.querySelectorAll('.nav-btn');
const form = document.getElementById('fuelup-form');
const historyList = document.getElementById('history-list');
const toast = document.getElementById('toast');

// Stats elements
const statAvg = document.getElementById('stat-avg');
const statTotal = document.getElementById('stat-total');
const statLiters = document.getElementById('stat-liters');
const statDistance = document.getElementById('stat-distance');
const statCostKm = document.getElementById('stat-cost-km');
const statCount = document.getElementById('stat-count');

// Navigation
navBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.view;
    if (!target) return; // skip non-view buttons (theme toggle)
    views.forEach((v) => v.classList.toggle('active', v.id === target));
    navBtns.forEach((b) => b.classList.toggle('active', b.dataset.view ? b === btn : false));
    if (target === 'view-history' || target === 'view-stats') {
      refreshData();
    }
  });
});

// Form submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const entry = {
    date: document.getElementById('input-date').value,
    liters: parseFloat(document.getElementById('input-liters').value),
    pricePerLiter: parseFloat(document.getElementById('input-price').value),
    totalCost: parseFloat(document.getElementById('input-total').value),
    odometer: parseInt(document.getElementById('input-odometer').value, 10)
  };

  if (!entry.date || !entry.liters || !entry.odometer) {
    showToast('Uzupełnij datę, litry i przebieg');
    return;
  }

  // Auto-calculate total if not provided
  if (!entry.totalCost && entry.pricePerLiter) {
    entry.totalCost = parseFloat((entry.liters * entry.pricePerLiter).toFixed(2));
  }

  await addFuelup(entry);
  form.reset();
  document.getElementById('input-date').value = new Date().toISOString().split('T')[0];
  showToast('Tankowanie zapisane ✓');
});

// Auto-fill total cost
document.getElementById('input-liters').addEventListener('input', autoCalcTotal);
document.getElementById('input-price').addEventListener('input', autoCalcTotal);

function autoCalcTotal() {
  const liters = parseFloat(document.getElementById('input-liters').value);
  const price = parseFloat(document.getElementById('input-price').value);
  if (liters && price) {
    document.getElementById('input-total').value = (liters * price).toFixed(2);
  }
}

// OCR Scanner
const btnScan = document.getElementById('btn-scan');
const scanInput = document.getElementById('scan-input');
const scanStatus = document.getElementById('scan-status');
const scanProgressBar = document.getElementById('scan-progress-bar');
const scanStatusText = document.getElementById('scan-status-text');
const scanPreview = document.getElementById('scan-preview');
const scanImg = document.getElementById('scan-img');
const btnScanClear = document.getElementById('btn-scan-clear');

btnScan.addEventListener('click', () => {
  scanInput.click();
});

scanInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Show preview
  const url = URL.createObjectURL(file);
  scanImg.src = url;
  scanPreview.style.display = 'block';
  btnScan.style.display = 'none';

  // Show progress
  scanStatus.style.display = 'block';
  scanProgressBar.style.width = '10%';
  scanStatusText.textContent = 'Ładuję silnik OCR...';

  try {
    const result = await scanImage(file, (progress) => {
      scanProgressBar.style.width = `${progress}%`;
      scanStatusText.textContent = `Analizuję... ${progress}%`;
    });

    scanProgressBar.style.width = '100%';
    scanStatusText.textContent = getConfidenceText(result.confidence);

    // Fill form with results
    if (result.liters) {
      document.getElementById('input-liters').value = result.liters;
    }
    if (result.pricePerLiter) {
      document.getElementById('input-price').value = result.pricePerLiter;
    }
    if (result.totalCost) {
      document.getElementById('input-total').value = result.totalCost;
    }

    // Show confidence indicator
    showToast(result.confidence === 'high'
      ? 'Odczytano dane ✓ Sprawdź wartości'
      : 'Częściowy odczyt — popraw ręcznie');

  } catch (err) {
    scanStatusText.textContent = 'Błąd skanowania. Wpisz ręcznie.';
    console.error('OCR error:', err);
  }

  scanInput.value = '';
});

btnScanClear.addEventListener('click', () => {
  scanPreview.style.display = 'none';
  scanStatus.style.display = 'none';
  btnScan.style.display = 'block';
  URL.revokeObjectURL(scanImg.src);
});

function getConfidenceText(confidence) {
  switch (confidence) {
    case 'high': return '✅ Wysoka pewność odczytu';
    case 'medium': return '⚠️ Średnia pewność — sprawdź wartości';
    default: return '❓ Niska pewność — popraw ręcznie';
  }
}

// Refresh data
async function refreshData() {
  const fuelups = await getAllFuelups();
  renderHistory(fuelups);
  renderStats(fuelups);
}

// Render history
function renderHistory(fuelups) {
  if (fuelups.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="icon">⛽</div>
        <p>Brak tankowań.<br>Dodaj pierwsze tankowanie!</p>
      </div>`;
    return;
  }

  const consumption = calculateConsumption(fuelups);
  const consumptionMap = new Map(consumption.map((c) => [c.id, c.consumption]));

  const sorted = [...fuelups].sort((a, b) => new Date(b.date) - new Date(a.date));

  historyList.innerHTML = sorted
    .map((f) => {
      const cons = consumptionMap.get(f.id);
      return `
      <div class="history-item">
        <div class="left">
          <div class="date">${formatDate(f.date)}</div>
          <div class="details">${f.liters} L × ${f.pricePerLiter ? f.pricePerLiter.toFixed(2) + ' zł' : '—'} = ${f.totalCost ? f.totalCost.toFixed(2) + ' zł' : '—'}</div>
          <div class="date">Przebieg: ${f.odometer.toLocaleString()} km</div>
        </div>
        ${cons ? `<div class="consumption">${cons}<small> l/100km</small></div>` : '<div class="consumption">—</div>'}
        <button class="btn-delete" data-id="${f.id}" aria-label="Usuń tankowanie">×</button>
      </div>`;
    })
    .join('');

  // Delete handlers
  historyList.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Usunąć to tankowanie?')) {
        await deleteFuelup(parseInt(btn.dataset.id, 10));
        refreshData();
        showToast('Usunięto');
      }
    });
  });
}

// Render stats
let consumptionChart = null;
let priceChart = null;

function renderStats(fuelups) {
  const avg = getAverageConsumption(fuelups);
  const costKm = getCostPerKm(fuelups);
  statAvg.textContent = avg ? `${avg}` : '—';
  statCostKm.textContent = costKm ? `${costKm} zł` : '—';
  statTotal.textContent = `${getTotalSpent(fuelups)} zł`;
  statLiters.textContent = `${getTotalLiters(fuelups)} L`;
  statDistance.textContent = `${getTotalDistance(fuelups).toLocaleString()} km`;
  statCount.textContent = fuelups.length;

  // Consumption chart
  const consumption = calculateConsumption(fuelups);
  const chartCanvas = document.getElementById('chart-consumption');
  const chartEmpty = document.getElementById('chart-empty');

  if (consumption.length < 2) {
    chartCanvas.style.display = 'none';
    chartEmpty.style.display = 'block';
  } else {
    chartCanvas.style.display = 'block';
    chartEmpty.style.display = 'none';

    const labels = consumption.map((c) => {
      const d = new Date(c.date);
      return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    });
    const data = consumption.map((c) => Math.round(parseFloat(c.consumption) * 100) / 100);

    if (consumptionChart) consumptionChart.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();

    consumptionChart = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Spalanie (l/100km)',
          data,
          borderColor: '#4ecdc4',
          backgroundColor: 'rgba(78, 205, 196, 0.1)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#4ecdc4',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ctx.parsed.y.toFixed(2) + ' l/100km' } }
        },
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor + '33' } },
          y: {
            ticks: {
              color: textColor,
              callback: function(value) { return Number(value).toFixed(2) + ' l'; }
            },
            grid: { color: gridColor + '33' }
          }
        }
      }
    });
  }

  // Price chart
  const priceCanvas = document.getElementById('chart-price');
  const priceEmpty = document.getElementById('chart-price-empty');
  const withPrice = [...fuelups].filter((f) => f.pricePerLiter).sort((a, b) => new Date(a.date) - new Date(b.date));

  if (withPrice.length < 2) {
    priceCanvas.style.display = 'none';
    priceEmpty.style.display = 'block';
  } else {
    priceCanvas.style.display = 'block';
    priceEmpty.style.display = 'none';

    const priceLabels = withPrice.map((f) => {
      const d = new Date(f.date);
      return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    });
    const priceData = withPrice.map((f) => Math.round(f.pricePerLiter * 100) / 100);

    if (priceChart) priceChart.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();

    priceChart = new Chart(priceCanvas, {
      type: 'line',
      data: {
        labels: priceLabels,
        datasets: [{
          label: 'Cena/litr (zł)',
          data: priceData,
          borderColor: '#e94560',
          backgroundColor: 'rgba(233, 69, 96, 0.1)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#e94560',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ctx.parsed.y.toFixed(2) + ' zł/l' } }
        },
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor + '33' } },
          y: {
            ticks: {
              color: textColor,
              callback: function(value) { return Number(value).toFixed(2) + ' zł'; }
            },
            grid: { color: gridColor + '33' }
          }
        }
      }
    });
  }
}

// Helpers
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// Export/Import handlers
document.getElementById('btn-export').addEventListener('click', async () => {
  const result = await exportData();
  if (result.success) markExportDone();
  showToast(result.message);
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (confirm('Importowane dane zostaną DODANE do istniejących. Kontynuować?')) {
    const result = await importData(file);
    showToast(result.message);
    if (result.success) refreshData();
  }
  e.target.value = ''; // reset input
});

// Backup reminder
function checkBackupReminder() {
  const days = getDaysSinceLastExport();
  const reminder = document.getElementById('backup-reminder');
  if (days === null) {
    reminder.textContent = '⚠️ Nigdy nie robiono eksportu. Zrób backup!';
    reminder.style.display = 'block';
  } else if (days >= 14) {
    reminder.textContent = `⚠️ Ostatni backup: ${days} dni temu. Czas na nowy!`;
    reminder.style.display = 'block';
  } else {
    reminder.style.display = 'none';
  }
}

// Theme toggle
const btnTheme = document.getElementById('btn-theme');
const themeIcon = document.getElementById('theme-icon');

function loadTheme() {
  const saved = localStorage.getItem('fuel_tracker_theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeIcon.textContent = '🌙';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeIcon.textContent = '☀️';
  }
  localStorage.setItem('fuel_tracker_theme', theme);
}

btnTheme.addEventListener('click', () => {
  const current = localStorage.getItem('fuel_tracker_theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Init
document.getElementById('input-date').value = new Date().toISOString().split('T')[0];
loadTheme();
refreshData();
checkBackupReminder();
