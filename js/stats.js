/**
 * Oblicza spalanie między kolejnymi tankowaniami.
 * Dane muszą być posortowane po dacie (rosnąco).
 * Spalanie = litry / (przebieg_aktualny - przebieg_poprzedni) * 100
 */
function calculateConsumption(fuelups) {
  if (fuelups.length < 2) return [];

  const sorted = [...fuelups].sort((a, b) => a.odometer - b.odometer);
  const results = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const distance = curr.odometer - prev.odometer;

    if (distance > 0 && curr.liters > 0) {
      results.push({
        id: curr.id,
        date: curr.date,
        liters: curr.liters,
        distance: distance,
        consumption: ((curr.liters / distance) * 100).toFixed(2),
        pricePerLiter: curr.pricePerLiter,
        totalCost: curr.totalCost,
        odometer: curr.odometer
      });
    }
  }

  return results;
}

function getAverageConsumption(fuelups) {
  const data = calculateConsumption(fuelups);
  if (data.length === 0) return null;
  const sum = data.reduce((acc, d) => acc + parseFloat(d.consumption), 0);
  return (sum / data.length).toFixed(2);
}

function getTotalSpent(fuelups) {
  return fuelups.reduce((acc, f) => acc + (f.totalCost || 0), 0).toFixed(2);
}

function getTotalLiters(fuelups) {
  return fuelups.reduce((acc, f) => acc + (f.liters || 0), 0).toFixed(1);
}

function getTotalDistance(fuelups) {
  if (fuelups.length < 2) return 0;
  const sorted = [...fuelups].sort((a, b) => a.odometer - b.odometer);
  return sorted[sorted.length - 1].odometer - sorted[0].odometer;
}

function getCostPerKm(fuelups) {
  const totalSpent = fuelups.reduce((acc, f) => acc + (f.totalCost || 0), 0);
  const distance = getTotalDistance(fuelups);
  if (distance === 0) return null;
  return (totalSpent / distance).toFixed(2);
}

export { calculateConsumption, getAverageConsumption, getTotalSpent, getTotalLiters, getTotalDistance, getCostPerKm };
