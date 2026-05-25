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
    .replace(/[lI]/g, '1') // common OCR mistake
    .replace(/\s+/g, ' ');

  // Find all numbers with decimals
  const numbers = [];
  const regex = /(\d+\.?\d*)/g;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const num = parseFloat(match[1]);
    if (num > 0 && num < 10000) {
      numbers.push(num);
    }
  }

  console.log('Extracted numbers:', numbers);

  // Heuristic classification
  const result = {
    liters: null,
    pricePerLiter: null,
    totalCost: null,
    rawText: text,
    allNumbers: numbers,
    confidence: 'low'
  };

  if (numbers.length === 0) return result;

  // Try to classify numbers by typical ranges
  const candidates = {
    price: [],    // 4.00 - 10.00 (price per liter in PLN)
    liters: [],   // 5.00 - 80.00 (typical tank fill)
    total: []     // 30.00 - 800.00 (total cost)
  };

  for (const num of numbers) {
    if (num >= 4.0 && num <= 10.0) candidates.price.push(num);
    if (num >= 3.0 && num <= 85.0) candidates.liters.push(num);
    if (num >= 20.0 && num <= 900.0) candidates.total.push(num);
  }

  // Best guesses
  if (candidates.price.length > 0) {
    result.pricePerLiter = candidates.price[0];
  }

  if (candidates.total.length > 0) {
    // Total is usually the largest number
    result.totalCost = Math.max(...candidates.total);
  }

  if (candidates.liters.length > 0) {
    // Liters: if we have price and total, calculate; otherwise pick middle-range number
    if (result.pricePerLiter && result.totalCost) {
      const calculated = result.totalCost / result.pricePerLiter;
      // Find the closest number to calculated value
      const closest = candidates.liters.reduce((prev, curr) =>
        Math.abs(curr - calculated) < Math.abs(prev - calculated) ? curr : prev
      );
      result.liters = closest;
      result.confidence = 'high';
    } else {
      // Pick a number that's not the same as price or total
      const filtered = candidates.liters.filter(
        (n) => n !== result.pricePerLiter && n !== result.totalCost
      );
      result.liters = filtered.length > 0 ? filtered[0] : candidates.liters[0];
    }
  }

  // Validate: liters * price ≈ total?
  if (result.liters && result.pricePerLiter && result.totalCost) {
    const expected = result.liters * result.pricePerLiter;
    const diff = Math.abs(expected - result.totalCost) / result.totalCost;
    if (diff < 0.05) {
      result.confidence = 'high';
    } else if (diff < 0.15) {
      result.confidence = 'medium';
    }
  } else if (result.liters || result.totalCost) {
    result.confidence = 'medium';
  }

  return result;
}

export { scanImage, parseOCRText };
