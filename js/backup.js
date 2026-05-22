import { getAllFuelups, addFuelup } from './db.js';

/**
 * Export all fuelups as a JSON file download.
 */
async function exportData() {
  const fuelups = await getAllFuelups();

  if (fuelups.length === 0) {
    return { success: false, message: 'Brak danych do eksportu' };
  }

  const exportObj = {
    app: 'fuel-tracker',
    version: 1,
    exportDate: new Date().toISOString(),
    count: fuelups.length,
    data: fuelups.map(({ id, ...rest }) => rest) // exclude internal IDs
  };

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `fuel-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { success: true, message: `Wyeksportowano ${fuelups.length} tankowań` };
}

/**
 * Import fuelups from a JSON file.
 * Returns count of imported entries.
 */
async function importData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target.result);

        // Validate format
        if (!parsed.app || parsed.app !== 'fuel-tracker' || !Array.isArray(parsed.data)) {
          resolve({ success: false, message: 'Nieprawidłowy format pliku' });
          return;
        }

        let imported = 0;
        for (const entry of parsed.data) {
          // Validate required fields
          if (entry.date && entry.liters && entry.odometer) {
            await addFuelup({
              date: entry.date,
              liters: parseFloat(entry.liters),
              pricePerLiter: entry.pricePerLiter ? parseFloat(entry.pricePerLiter) : null,
              totalCost: entry.totalCost ? parseFloat(entry.totalCost) : null,
              odometer: parseInt(entry.odometer, 10)
            });
            imported++;
          }
        }

        resolve({ success: true, message: `Zaimportowano ${imported} tankowań` });
      } catch (err) {
        resolve({ success: false, message: 'Błąd odczytu pliku: ' + err.message });
      }
    };

    reader.onerror = () => resolve({ success: false, message: 'Nie udało się odczytać pliku' });
    reader.readAsText(file);
  });
}

export { exportData, importData };
