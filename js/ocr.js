/**
 * OCR module using Tesseract.js for reading fuel pump displays.
 * Loads Tesseract from CDN on first use (~2MB).
 * Includes image preprocessing for LCD/LED displays.
 */

let worker = null;
let isInitialized = false;

/**
 * Initialize Tesseract worker (lazy load on first scan).
 */
async function initOCR(onProgress) {
  if (isInitialized && worker) return;

  const { createWorker } = Tesseract;

  worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 100));
      }
    }
  });

  // Optimize for numbers and common fuel pump characters
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789., ',
    tessedit_pageseg_mode: '6' // Assume uniform block of text
  });

  isInitialized = true;
}

/**
 * Preprocess image for better OCR on LCD/LED displays.
 * Steps:
 * 1. Convert to grayscale
 * 2. Increase contrast (stretch histogram)
 * 3. Apply threshold to get black/white (isolate bright digits)
 * 4. Invert if needed (ensure dark text on light background)
 */
function preprocessImage(imageSource) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Step 1: Convert to grayscale and find min/max for contrast stretch
      const gray = new Uint8Array(data.length / 4);
      let min = 255, max = 0;

      for (let i = 0; i < data.length; i += 4) {
        const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        gray[i / 4] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }

      // Step 2: Contrast stretch + threshold
      const range = max - min || 1;
      const threshold = min + range * 0.55; // adaptive threshold

      // Count bright vs dark pixels to determine if we need to invert
      let brightCount = 0;
      for (let i = 0; i < gray.length; i++) {
        if (gray[i] > threshold) brightCount++;
      }

      // If most pixels are dark (LCD display with bright digits), invert
      const shouldInvert = brightCount < gray.length * 0.4;

      // Step 3: Apply threshold and optional invert
      for (let i = 0; i < gray.length; i++) {
        const stretched = ((gray[i] - min) / range) * 255;
        let val = stretched > (threshold - min) / range * 255 ? 255 : 0;

        if (shouldInvert) val = 255 - val;

        const idx = i * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }

      ctx.putImageData(imageData, 0, 0);

      // Step 4: Scale up small images (helps OCR accuracy)
      if (canvas.width < 600) {
        const scale = 2;
        const scaled = document.createElement('canvas');
        scaled.width = canvas.width * scale;
        scaled.height = canvas.height * scale;
        const sctx = scaled.getContext('2d');
        sctx.imageSmoothingEnabled = false;
        sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
        resolve(scaled);
      } else {
        resolve(canvas);
      }
    };

    // Handle both File and URL sources
    if (imageSource instanceof File || imageSource instanceof Blob) {
      img.src = URL.createObjectURL(imageSource);
    } else {
      img.src = imageSource;
    }
  });
}

/**
 * Process an image and extract fuel data.
 * Returns { liters, pricePerLiter, totalCost } with confidence scores.
 */
async function scanImage(imageSource, onProgress) {
  await initOCR(onProgress);

  // Preprocess for LCD/LED display
  const processed = await preprocessImage(imageSource);

  const { data } = await worker.recognize(processed);
  const text = data.text;

  console.log('OCR raw text:', text);

  return parseOCRText(text);
}

/**
 * Parse OCR text and try to extract fuel pump values.
 * Looks for patterns like:
 *   - Liters: XX.XX (usually 2 decimal places, range 1-99)
 *   - Price per liter: X.XX (usually 5-10 range in PLN)
 *   - Total cost: XXX.XX (usually 50-500 range)
 */
function parseOCRText(text) {
  // Normalize text: replace commas with dots, clean up
  const normalized = text
    .replace(/,/g, '.')
    .replace(/[oO]/g, '0') // common OCR mistake
    .replace(/\s+/g, ' ');

  console.log('OCR normalized text:', normalized);

  // --- Strategy 1: Look for multiplication pattern (receipt format) ---
  // Receipts often show: 33.13 x 6.460 or 33.13 * 6.46 = 214.02
  const multiplyPattern = /(\d+\.?\d*)\s*[x×\*]\s*(\d+\.?\d*)/gi;
  let multiplyMatch = multiplyPattern.exec(normalized);

  if (multiplyMatch) {
    const a = parseFloat(multiplyMatch[1]);
    const b = parseFloat(multiplyMatch[2]);

    if (a > 0 && b > 0) {
      // Determine which is liters and which is price
      let liters, pricePerLiter;
      if (a >= 4.0 && a <= 10.0 && b > 10) {
        // a is price, b is liters (price x liters format)
        pricePerLiter = a;
        liters = b;
      } else if (b >= 4.0 && b <= 10.0 && a > 10) {
        // a is liters, b is price (liters x price format)
        liters = a;
        pricePerLiter = b;
      } else if (a > b) {
        // Larger number is likely liters
        liters = a;
        pricePerLiter = b;
      } else {
        liters = b;
        pricePerLiter = a;
      }

      const totalCost = Math.round(liters * pricePerLiter * 100) / 100;

      console.log('Found multiply pattern:', a, 'x', b);
      return {
        liters,
        pricePerLiter,
        totalCost,
        rawText: text,
        allNumbers: [a, b, totalCost],
        confidence: 'high'
      };
    }
  }

  // --- Strategy 2: Find all numbers and use cross-validation ---
  const numbers = [];
  const regex = /(\d+\.?\d*)/g;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const num = parseFloat(match[1]);
    if (num > 0 && num < 10000) {
      numbers.push(num);
    }
  }

  // Filter out known noise values from fuel pump labels
  const noiseValues = new Set([
    5, 5.0, 5.00,       // "min. 5l" label
    0.01,               // "dokładność 0.01l" label
    0.1, 0.5, 1.0,     // other measurement labels
    10, 20, 50, 100,    // round numbers from promo stickers
    1, 2, 3, 4,         // single digits (usually noise)
  ]);

  const filtered = numbers.filter((n) => {
    if (noiseValues.has(n)) return false;
    if (n < 0.1) return false;
    if (n >= 2000 && n <= 2099) return false;
    return true;
  });

  console.log('All numbers:', numbers);
  console.log('After noise filter:', filtered);

  // --- Strategy 3: Try all triplet combinations for a*b≈c ---
  const bestTriplet = findBestTriplet(filtered);
  if (bestTriplet) {
    return {
      ...bestTriplet,
      rawText: text,
      allNumbers: filtered,
      confidence: bestTriplet.confidence
    };
  }

  // --- Strategy 4: Try pair combinations (calculate missing value) ---
  const bestPair = findBestPair(filtered);
  if (bestPair) {
    return {
      ...bestPair,
      rawText: text,
      allNumbers: filtered,
      confidence: 'medium'
    };
  }

  // --- Fallback: Simple range-based heuristic ---
  const result = {
    liters: null,
    pricePerLiter: null,
    totalCost: null,
    rawText: text,
    allNumbers: filtered,
    confidence: 'low'
  };

  if (filtered.length === 0) return result;

  const candidates = {
    price: filtered.filter((n) => n >= 4.0 && n <= 10.0),
    liters: filtered.filter((n) => n >= 5.01 && n <= 85.0),
    total: filtered.filter((n) => n >= 20.0 && n <= 900.0)
  };

  if (candidates.price.length > 0) result.pricePerLiter = candidates.price[0];
  if (candidates.total.length > 0) result.totalCost = Math.max(...candidates.total);
  if (candidates.liters.length > 0) {
    const notUsed = candidates.liters.filter(
      (n) => n !== result.pricePerLiter && n !== result.totalCost
    );
    result.liters = notUsed.length > 0 ? notUsed[0] : candidates.liters[0];
  }

  return result;
}

/**
 * Try all combinations of 3 numbers to find a*b≈c pattern.
 * Returns the best match with assigned roles (liters, price, total).
 */
function findBestTriplet(numbers) {
  if (numbers.length < 3) return null;

  let bestMatch = null;
  let bestError = Infinity;

  for (let i = 0; i < numbers.length; i++) {
    for (let j = 0; j < numbers.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < numbers.length; k++) {
        if (k === i || k === j) continue;

        const a = numbers[i]; // candidate factor 1
        const b = numbers[j]; // candidate factor 2
        const c = numbers[k]; // candidate product

        // Check if a * b ≈ c
        const product = a * b;
        if (c === 0) continue;
        const error = Math.abs(product - c) / c;

        if (error < 0.03 && error < bestError) { // within 3% tolerance
          // Determine which is price and which is liters
          let liters, pricePerLiter;

          if (a >= 4.0 && a <= 10.0 && b > 10) {
            pricePerLiter = a;
            liters = b;
          } else if (b >= 4.0 && b <= 10.0 && a > 10) {
            pricePerLiter = b;
            liters = a;
          } else if (a < b) {
            pricePerLiter = a;
            liters = b;
          } else {
            pricePerLiter = b;
            liters = a;
          }

          // Sanity check ranges
          if (pricePerLiter >= 3.5 && pricePerLiter <= 12.0 &&
              liters >= 3.0 && liters <= 90.0 &&
              c >= 15.0 && c <= 1000.0) {
            bestError = error;
            bestMatch = {
              liters,
              pricePerLiter,
              totalCost: c,
              confidence: error < 0.01 ? 'high' : 'medium'
            };
          }
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Try pairs of numbers: if we have two values, calculate the third.
 * Returns best match where calculated value is sensible.
 */
function findBestPair(numbers) {
  if (numbers.length < 2) return null;

  for (let i = 0; i < numbers.length; i++) {
    for (let j = i + 1; j < numbers.length; j++) {
      const a = numbers[i];
      const b = numbers[j];

      // Case 1: a=total, b=price → liters = a/b
      if (a >= 20 && a <= 900 && b >= 4.0 && b <= 10.0) {
        const liters = a / b;
        if (liters >= 3.0 && liters <= 90.0) {
          return {
            liters: Math.round(liters * 100) / 100,
            pricePerLiter: b,
            totalCost: a
          };
        }
      }

      // Case 2: b=total, a=price → liters = b/a
      if (b >= 20 && b <= 900 && a >= 4.0 && a <= 10.0) {
        const liters = b / a;
        if (liters >= 3.0 && liters <= 90.0) {
          return {
            liters: Math.round(liters * 100) / 100,
            pricePerLiter: a,
            totalCost: b
          };
        }
      }

      // Case 3: a=liters, b=price → total = a*b
      if (a >= 5.0 && a <= 85.0 && b >= 4.0 && b <= 10.0) {
        const total = a * b;
        if (total >= 15 && total <= 900) {
          return {
            liters: a,
            pricePerLiter: b,
            totalCost: Math.round(total * 100) / 100
          };
        }
      }

      // Case 4: b=liters, a=price → total = a*b
      if (b >= 5.0 && b <= 85.0 && a >= 4.0 && a <= 10.0) {
        const total = a * b;
        if (total >= 15 && total <= 900) {
          return {
            liters: b,
            pricePerLiter: a,
            totalCost: Math.round(total * 100) / 100
          };
        }
      }
    }
  }

  return null;
}

export { scanImage, parseOCRText };
