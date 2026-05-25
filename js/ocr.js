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

  // Optimize for numbers and fuel receipt characters
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789.,*x×= ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
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
 * @param {File|Blob} imageSource - image to scan
 * @param {Function} onProgress - progress callback
 * @param {string} mode - 'display' for LCD pump displays, 'receipt' for paper receipts
 */
async function scanImage(imageSource, onProgress, mode = 'receipt') {
  await initOCR(onProgress);

  let source;
  if (mode === 'display') {
    // Preprocess only for LCD/LED displays (high contrast, threshold)
    source = await preprocessImage(imageSource);
  } else {
    // For receipts: no preprocessing — Tesseract handles printed text well
    source = imageSource;
  }

  const { data } = await worker.recognize(source);
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
  console.log('OCR raw text:', text);

  // Normalize: replace commas with dots for decimals
  const normalized = text.replace(/,/g, '.');

  // --- Strategy 1: Find fuel line by context keywords ---
  // Split into lines and look for fuel-related keywords
  const lines = normalized.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const fuelKeywords = /\b(95|98|ON|Pb|PB|pb|diesel|DIESEL|LPG|lpg|benzyna|BENZYNA|verva|VERVA|efecta|EFECTA|dynamic|DYNAMIC)\b/i;

  let fuelLine = null;
  let fuelLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (fuelKeywords.test(lines[i])) {
      fuelLine = lines[i];
      fuelLineIndex = i;
      break;
    }
  }

  console.log('Fuel line found:', fuelLine);

  // --- Strategy 2: Look for multiplication pattern near fuel line ---
  // Check fuel line and adjacent lines for pattern: number * number or number x number
  const searchLines = [];
  if (fuelLineIndex >= 0) {
    // Look at fuel line and up to 2 lines below (multiplication often on next line)
    for (let i = fuelLineIndex; i < Math.min(fuelLineIndex + 3, lines.length); i++) {
      searchLines.push(lines[i]);
    }
  } else {
    // No fuel keyword found — search all lines
    searchLines.push(...lines);
  }

  const searchText = searchLines.join(' ');
  const multiplyPattern = /(\d+\.?\d*)\s*[x×\*]\s*(\d+\.?\d*)/gi;
  let multiplyMatch = multiplyPattern.exec(searchText);

  if (multiplyMatch) {
    const a = parseFloat(multiplyMatch[1]);
    const b = parseFloat(multiplyMatch[2]);

    if (a > 0 && b > 0) {
      let liters, pricePerLiter;

      // Determine roles: price is 4-10 range, liters is larger
      if (a >= 4.0 && a <= 10.0 && b > 10) {
        pricePerLiter = a;
        liters = b;
      } else if (b >= 4.0 && b <= 10.0 && a > 10) {
        liters = a;
        pricePerLiter = b;
      } else if (b >= 4.0 && b <= 10.0) {
        pricePerLiter = b;
        liters = a;
      } else if (a >= 4.0 && a <= 10.0) {
        pricePerLiter = a;
        liters = b;
      } else if (a > b) {
        liters = a;
        pricePerLiter = b;
      } else {
        liters = b;
        pricePerLiter = a;
      }

      const totalCost = Math.round(liters * pricePerLiter * 100) / 100;

      console.log('Found multiply pattern:', a, 'x', b, '=', totalCost);
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

  // --- Strategy 3: Extract numbers from fuel line area and find a*b≈c triplet ---
  let numbersToCheck = [];

  if (fuelLineIndex >= 0) {
    // Only use numbers from fuel line and nearby lines (±2)
    const nearbyText = lines
      .slice(Math.max(0, fuelLineIndex - 1), Math.min(lines.length, fuelLineIndex + 4))
      .join(' ');
    numbersToCheck = extractNumbers(nearbyText);
  } else {
    // No fuel line found — use all numbers but be strict
    numbersToCheck = extractNumbers(normalized);
  }

  console.log('Numbers to check:', numbersToCheck);

  const bestTriplet = findBestTriplet(numbersToCheck);
  if (bestTriplet) {
    return {
      ...bestTriplet,
      rawText: text,
      allNumbers: numbersToCheck,
      confidence: bestTriplet.confidence
    };
  }

  // --- No confident result: return empty ---
  console.log('No confident match found. Returning empty.');
  return {
    liters: null,
    pricePerLiter: null,
    totalCost: null,
    rawText: text,
    allNumbers: numbersToCheck,
    confidence: 'none'
  };
}

/**
 * Extract meaningful numbers from text, filtering obvious noise.
 */
function extractNumbers(text) {
  const numbers = [];
  const regex = /(\d+\.?\d*)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const num = parseFloat(match[1]);
    if (num >= 0.5 && num < 5000) {
      // Skip years
      if (num >= 2000 && num <= 2099) continue;
      // Skip very round numbers that are likely labels
      if (num === 100 || num === 200 || num === 500 || num === 1000) continue;
      numbers.push(num);
    }
  }

  return numbers;
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

export { scanImage, parseOCRText };
