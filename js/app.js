import { addFuelup, getAllFuelups, deleteFuelup, getDaysSinceLastExport, markExportDone } from './db.js';
import { calculateConsumption, getAverageConsumption, getTotalSpent, getTotalLiters, getTotalDistance } from './stats.js';
import { exportData, importData } from './backup.js';

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

// Navigation
navBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.view;
    views.forEach((v) => v.classList.toggle('active', v.id === target));
    navBtns.forEach((b) => b.classList.toggle('active', b === btn));
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
function renderStats(fuelups) {
  const avg = getAverageConsumption(fuelups);
  statAvg.textContent = avg ? `${avg}` : '—';
  statTotal.textContent = `${getTotalSpent(fuelups)} zł`;
  statLiters.textContent = `${getTotalLiters(fuelups)} L`;
  statDistance.textContent = `${getTotalDistance(fuelups).toLocaleString()} km`;
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

// Init
document.getElementById('input-date').value = new Date().toISOString().split('T')[0];
refreshData();
checkBackupReminder();
