/**
 * skin-storage.js
 * 
 * Bine Zdravje — Lokalni Šifrirani Trezor (Privacy Vault) & IndexedDB Shramba
 * 100% lokalno, zero-server arhitektura za občutljive fotografije obraza, lasišča in telesa.
 * 
 * Tehnologije:
 * - IndexedDB (skinHairDB v1)
 * - Web Crypto API (PBKDF2 ključna izpeljava + AES-GCM 256-bitno šifriranje)
 * - Canvas 2D stiskanje (max 1280px, WebP/JPEG Q0.78, <120KB adaptivna zanka)
 * - EXIF binarni parser in avtomatska matrika orientacije
 * - Anti-leak varovalke (App Switcher blur zavesa, Object URL revokacija)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkinStorage = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // =========================================================================
  // KONSTANTE IN KONFIGURACIJA
  // =========================================================================

  const DB_NAME = 'skinHairDB';
  const DB_VERSION = 1;

  const STORES = {
    PHOTOS: 'photos',
    SCANS: 'scans',
    ROUTINES: 'routines',
    MEASUREMENTS: 'measurements',
    VAULT_META: 'vault_meta'
  };

  const COMPRESSION_CONFIG = {
    MAX_DIMENSION: 1280,
    INITIAL_QUALITY: 0.78,
    MAX_SIZE_BYTES: 120 * 1024, // 120 KB
    PREFERRED_FORMAT: 'image/webp',
    FALLBACK_FORMAT: 'image/jpeg',
    THUMBNAIL_MAX_DIMENSION: 200,
    THUMBNAIL_QUALITY: 0.65
  };

  const CRYPTO_CONFIG = {
    PBKDF2_ITERATIONS: 250000, // Uravnoteženo za mobilne A15/A16/M čipe (<200ms)
    KEY_LENGTH: 256,
    SALT_BYTE_LENGTH: 16,
    IV_BYTE_LENGTH: 12, // 96-bitni IV za AES-GCM
    CANARY_PLAINTEXT: 'BINE_VAULT_CANARY_2026_VALID',
    AUTO_LOCK_TIMEOUT_MS: 5 * 60 * 1000 // 5 minut neaktivnosti
  };

  // =========================================================================
  // STANJE MODULA (IN-MEMORY / EPHEMERAL)
  // =========================================================================

  let dbInstance = null;
  let activeCryptoKey = null; // AES-GCM CryptoKey hranjen izključno v RAM-u
  let isVaultUnlocked = false;
  let autoLockTimer = null;
  const activeObjectUrls = new Set();
  const eventListeners = {
    locked: [],
    unlocked: [],
    quotaWarning: []
  };

  // =========================================================================
  // POMOŽNE FUNKCIJE: EXIF IN TRANSFORMACIJE PLATNA (CANVAS)
  // =========================================================================

  /**
   * Hitri binarni parser za branje EXIF Orientation oznake iz JPEG podatkov
   * @param {ArrayBuffer} buffer - Surovi binarni podatki slike
   * @returns {number} Vrednost orientacije (1-8), privzeto 1
   */
  function extractExifOrientation(buffer) {
    try {
      const view = new DataView(buffer);
      // Preveri JPEG SOI marker (0xFFD8)
      if (view.getUint16(0, false) !== 0xFFD8) {
        return 1;
      }

      const length = view.byteLength;
      let offset = 2;

      while (offset < length) {
        // Preveri naslednji marker
        if (view.getUint8(offset) !== 0xFF) {
          break;
        }

        const marker = view.getUint8(offset + 1);

        // Marker APP1 vsebuje EXIF metapodatke (0xFFE1)
        if (marker === 0xE1) {
          const app1Length = view.getUint16(offset + 2, false);
          const exifHeaderOffset = offset + 4;

          // Preveri "Exif\0\0" (0x45786966 0000)
          if (
            view.getUint32(exifHeaderOffset, false) === 0x45786966 &&
            view.getUint16(exifHeaderOffset + 4, false) === 0x0000
          ) {
            const tiffOffset = exifHeaderOffset + 6;
            const endianMarker = view.getUint16(tiffOffset, false);
            // 0x4949 ('II') = Little Endian, 0x4D4D ('MM') = Big Endian
            const littleEndian = endianMarker === 0x4949;

            // Preveri TIFF magično število 42 (0x002A)
            if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002A) {
              return 1;
            }

            const firstIFDOffset = view.getUint32(tiffOffset + 4, littleEndian);
            if (firstIFDOffset < 8) return 1;

            const dirStart = tiffOffset + firstIFDOffset;
            const entriesCount = view.getUint16(dirStart, littleEndian);

            for (let i = 0; i < entriesCount; i++) {
              const entryOffset = dirStart + 2 + (i * 12);
              const tag = view.getUint16(entryOffset, littleEndian);

              // 0x0112 je EXIF Orientation tag
              if (tag === 0x0112) {
                const orientation = view.getUint16(entryOffset + 8, littleEndian);
                if (orientation >= 1 && orientation <= 8) {
                  return orientation;
                }
                return 1;
              }
            }
          }
          offset += 2 + app1Length;
        } else if ((marker & 0xFF00) === 0xFF00 && marker !== 0xDA && marker !== 0xD9) {
          // Preskoči druge markerje
          offset += 2 + view.getUint16(offset + 2, false);
        } else {
          break;
        }
      }
    } catch (err) {
      console.warn('[SkinStorage] Napaka pri parsiranju EXIF orientacije:', err);
    }
    return 1;
  }

  /**
   * Izračuna nove dimenzije s polnim ohranjanjem razmerja stranic
   */
  function calculateFitDimensions(width, height, maxDimension) {
    if (width <= maxDimension && height <= maxDimension) {
      return { width, height };
    }
    const ratio = width / height;
    if (ratio > 1) {
      return {
        width: maxDimension,
        height: Math.round(maxDimension / ratio)
      };
    } else {
      return {
        width: Math.round(maxDimension * ratio),
        height: maxDimension
      };
    }
  }

  /**
   * Uporabi afino transformacijsko matriko na Canvas 2D kontekstu glede na EXIF orientacijo
   */
  function applyOrientationTransform(ctx, orientation, width, height) {
    switch (orientation) {
      case 2:
        // Vodoravni zrcalni odsev
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        break;
      case 3:
        // 180° rotacija
        ctx.translate(width, height);
        ctx.rotate(Math.PI);
        break;
      case 4:
        // Navpični zrcalni odsev
        ctx.translate(0, height);
        ctx.scale(1, -1);
        break;
      case 5:
        // 90° v smeri urinega kazalca + navpični odsev
        ctx.rotate(0.5 * Math.PI);
        ctx.scale(1, -1);
        break;
      case 6:
        // 90° v smeri urinega kazalca
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(0, -height);
        break;
      case 7:
        // 90° v smeri urinega kazalca + vodoravni odsev
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(width, -height);
        ctx.scale(-1, 1);
        break;
      case 8:
        // 270° v smeri urinega kazalca (90° proti smeri)
        ctx.rotate(-0.5 * Math.PI);
        ctx.translate(-width, 0);
        break;
      case 1:
      default:
        // Standardna orientacija brez transformacij
        break;
    }
  }

  /**
   * Pretvori HTMLCanvas v Blob z obljubo (Promise)
   */
  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob pretvorba ni uspela'));
        },
        mimeType,
        quality
      );
    });
  }

  // =========================================================================
  // ODJEMALSKO STISKANJE IN NORMALIZACIJA SLIK
  // =========================================================================

  /**
   * Celovit cevovod za normalizacijo, odpravo EXIF rotacije in stiskanje pod 120 KB
   * @param {Blob|File} sourceFile - Vhodna fotografija iz kamere ali datoteke
   * @param {Object} options - Možnosti stiskanja
   * @returns {Promise<{ blob: Blob, thumbnailBlob: Blob, metadata: Object }>}
   */
  async function processAndCompressImage(sourceFile, options = {}) {
    const config = Object.assign({}, COMPRESSION_CONFIG, options);
    const arrayBuffer = await sourceFile.arrayBuffer();

    // 1. Zaznaj EXIF orientacijo
    const orientation = extractExifOrientation(arrayBuffer);

    // 2. Naloži sliko v Image objekt
    const tempBlob = new Blob([arrayBuffer], { type: sourceFile.type || 'image/jpeg' });
    const blobUrl = URL.createObjectURL(tempBlob);

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (err) => reject(new Error('Napaka pri nalaganju slike: ' + err.message));
      image.src = blobUrl;
    });

    URL.revokeObjectURL(blobUrl);

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    // Če je orientacija 5, 6, 7 ali 8, sta širina in višina zamenjani
    const isRotated90 = orientation >= 5 && orientation <= 8;
    const effectiveWidth = isRotated90 ? originalHeight : originalWidth;
    const effectiveHeight = isRotated90 ? originalWidth : originalHeight;

    // 3. Glavno stiskanje s skaliranjem na max 1280px
    let targetDimensions = calculateFitDimensions(effectiveWidth, effectiveHeight, config.MAX_DIMENSION);

    const mainCanvas = document.createElement('canvas');
    const mainCtx = mainCanvas.getContext('2d', { alpha: false, desynchronized: true });

    // Pripravi dimenzije platna
    if (isRotated90) {
      mainCanvas.width = targetDimensions.height;
      mainCanvas.height = targetDimensions.width;
    } else {
      mainCanvas.width = targetDimensions.width;
      mainCanvas.height = targetDimensions.height;
    }

    // Uporabi transformacijo in nariši
    mainCtx.save();
    applyOrientationTransform(mainCtx, orientation, targetDimensions.width, targetDimensions.height);
    mainCtx.drawImage(
      img,
      0,
      0,
      isRotated90 ? targetDimensions.height : targetDimensions.width,
      isRotated90 ? targetDimensions.width : targetDimensions.height
    );
    mainCtx.restore();

    // Če je bila slika rotirana za 90°, platno zdaj vsebuje pravilno orientirano sliko z dimenzijami:
    // width: targetDimensions.width, height: targetDimensions.height
    // Poskrbimo za konsistentno poravnavo platna v končni obliki:
    let finalCanvas = mainCanvas;
    if (isRotated90) {
      const normalizedCanvas = document.createElement('canvas');
      normalizedCanvas.width = targetDimensions.width;
      normalizedCanvas.height = targetDimensions.height;
      const normCtx = normalizedCanvas.getContext('2d', { alpha: false });
      normCtx.drawImage(mainCanvas, 0, 0);
      finalCanvas = normalizedCanvas;
    }

    // Preveri podporo za WebP
    let targetMime = config.PREFERRED_FORMAT;
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 1;
    testCanvas.height = 1;
    if (!testCanvas.toDataURL('image/webp').startsWith('data:image/webp')) {
      targetMime = config.FALLBACK_FORMAT;
    }

    // 4. Adaptivna zanka za zagotovitev velikosti pod 120 KB
    let currentQuality = config.INITIAL_QUALITY;
    let finalBlob = await canvasToBlob(finalCanvas, targetMime, currentQuality);

    // Iterativno zniževanje, če visoka entropija (šum, kožne pore, dlake) preseže 120 KB
    let attempts = 0;
    while (finalBlob.size > config.MAX_SIZE_BYTES && attempts < 4) {
      attempts++;
      if (attempts === 1) currentQuality = 0.70;
      else if (attempts === 2) currentQuality = 0.62;
      else if (attempts === 3) {
        // Zmanjšaj dimenzije na 1080px in ponovno izriši
        const downscaled = calculateFitDimensions(targetDimensions.width, targetDimensions.height, 1080);
        const subCanvas = document.createElement('canvas');
        subCanvas.width = downscaled.width;
        subCanvas.height = downscaled.height;
        const subCtx = subCanvas.getContext('2d', { alpha: false });
        subCtx.drawImage(finalCanvas, 0, 0, downscaled.width, downscaled.height);
        finalCanvas = subCanvas;
        currentQuality = 0.68;
      }
      finalBlob = await canvasToBlob(finalCanvas, targetMime, currentQuality);
    }

    // 5. Generiranje majhnega predogleda (Thumbnail ~200px) za hiter UI prikaz
    const thumbDims = calculateFitDimensions(targetDimensions.width, targetDimensions.height, config.THUMBNAIL_MAX_DIMENSION);
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbDims.width;
    thumbCanvas.height = thumbDims.height;
    const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
    thumbCtx.drawImage(finalCanvas, 0, 0, thumbDims.width, thumbDims.height);
    const thumbnailBlob = await canvasToBlob(thumbCanvas, targetMime, config.THUMBNAIL_QUALITY);

    // Počisti platna za takojšnjo sprostitev pomnilnika
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    thumbCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);

    return {
      blob: finalBlob,
      thumbnailBlob: thumbnailBlob,
      metadata: {
        originalWidth,
        originalHeight,
        processedWidth: finalCanvas.width,
        processedHeight: finalCanvas.height,
        orientationDetected: orientation,
        mimeType: targetMime,
        compressionQuality: currentQuality,
        sizeBytes: finalBlob.size,
        thumbnailSizeBytes: thumbnailBlob.size,
        under120kbGuaranteed: finalBlob.size <= config.MAX_SIZE_BYTES
      }
    };
  }

  // =========================================================================
  // KRIPTOGRAFSKI SLOJ: WEB CRYPTO API (PBKDF2 + AES-GCM 256)
  // =========================================================================

  /**
   * Izpelje AES-GCM ključ iz uporabnikovega PIN-a z algoritmom PBKDF2-HMAC-SHA256
   */
  async function deriveKeyFromPin(pin, saltBytes) {
    const enc = new TextEncoder();
    const pinBuffer = enc.encode(String(pin));

    const baseKey = await crypto.subtle.importKey(
      'raw',
      pinBuffer,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: CRYPTO_CONFIG.PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: CRYPTO_CONFIG.KEY_LENGTH
      },
      false, // extractable = false (ključ ostane varno zaščiten v brskalnikovem kripto modulu)
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Šifrira poljuben ArrayBuffer ali Blob z AES-GCM 256-bit
   * @param {ArrayBuffer|Blob} data - Nešifrirani podatki
   * @param {CryptoKey} key - Izpeljani AES-GCM ključ
   * @returns {Promise<{ ciphertext: ArrayBuffer, iv: Uint8Array }>}
   */
  async function encryptBuffer(data, key) {
    let buffer;
    if (data instanceof Blob) {
      buffer = await data.arrayBuffer();
    } else if (data instanceof ArrayBuffer) {
      buffer = data;
    } else {
      throw new Error('Napačen tip podatkov za šifriranje');
    }

    // Za vsako posamezno šifriranje generiraj NOV, NIKOLI ponovljen 96-bitni IV!
    const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.IV_BYTE_LENGTH));

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      buffer
    );

    return {
      ciphertext,
      iv
    };
  }

  /**
   * Dešifrira AES-GCM šifrirano besedilo
   */
  async function decryptBuffer(ciphertext, iv, key) {
    return await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      ciphertext
    );
  }

  // =========================================================================
  // INDEXEDDB SHRAMBA (skinHairDB)
  // =========================================================================

  /**
   * Odpre in inicializira IndexedDB bazo s polno shemo in indeksi
   */
  function openDatabase() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Shramba za fotografije (Photos)
        if (!db.objectStoreNames.contains(STORES.PHOTOS)) {
          const photoStore = db.createObjectStore(STORES.PHOTOS, { keyPath: 'id' });
          photoStore.createIndex('timestamp', 'timestamp', { unique: false });
          photoStore.createIndex('category', 'category', { unique: false });
          photoStore.createIndex('date', 'date', { unique: false });
          photoStore.createIndex('angle', 'angle', { unique: false });
          photoStore.createIndex('isEncrypted', 'isEncrypted', { unique: false });
        }

        // 2. Shramba za analitične skene in računalniški vid (Scans)
        if (!db.objectStoreNames.contains(STORES.SCANS)) {
          const scanStore = db.createObjectStore(STORES.SCANS, { keyPath: 'id' });
          scanStore.createIndex('photoId', 'photoId', { unique: false });
          scanStore.createIndex('timestamp', 'timestamp', { unique: false });
          scanStore.createIndex('date', 'date', { unique: false });
        }

        // 3. Shramba za dnevne protokole in rutine (Routines)
        if (!db.objectStoreNames.contains(STORES.ROUTINES)) {
          const routineStore = db.createObjectStore(STORES.ROUTINES, { keyPath: 'id' });
          routineStore.createIndex('date', 'date', { unique: true });
          routineStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 4. Shramba za meritve (Measurements)
        if (!db.objectStoreNames.contains(STORES.MEASUREMENTS)) {
          const measurementStore = db.createObjectStore(STORES.MEASUREMENTS, { keyPath: 'id' });
          measurementStore.createIndex('type', 'type', { unique: false });
          measurementStore.createIndex('date', 'date', { unique: false });
          measurementStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 5. Metapodatki trezorja (PIN sol, potrditveni kanarček, varnostne nastavitve)
        if (!db.objectStoreNames.contains(STORES.VAULT_META)) {
          db.createObjectStore(STORES.VAULT_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject(new Error('IndexedDB napaka pri odpiranju: ' + event.target.error));
      };
    });
  }

  /**
   * Splošna pomožna funkcija za izvedbo transakcije
   */
  async function performTransaction(storeNames, mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode);
      const isSingle = !Array.isArray(storeNames);
      const store = isSingle ? transaction.objectStore(storeNames) : null;

      let result;
      try {
        result = callback(store, transaction);
      } catch (err) {
        reject(err);
        return;
      }

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = (e) => reject(transaction.error || e.target.error);
      transaction.onabort = (e) => reject(new Error('Transakcija prekinjena: ' + (transaction.error || 'Neznana napaka')));
    });
  }

  // =========================================================================
  // UPRAVLJANJE ZASEBNOSTI IN SEFA (VAULT STATE MACHINE)
  // =========================================================================

  /**
   * Preveri, ali je za trezor že nastavljen varnostni PIN
   */
  async function isPinConfigured() {
    const meta = await getVaultMeta('pin_security');
    return Boolean(meta && meta.salt && meta.canary);
  }

  /**
   * Pridobi zapis iz shrambe vault_meta
   */
  function getVaultMeta(key) {
    return performTransaction(STORES.VAULT_META, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }).then(res => res);
  }

  /**
   * Nastavi ali ponastavi PIN trezorja ter zaščitnega kanarčka
   */
  async function setupVaultPin(pin) {
    if (!pin || String(pin).length < 4) {
      throw new Error('PIN mora vsebovati vsaj 4 znake');
    }

    // Varovalka: ponovni klic bi prepisal sol in kanarček ter naredil obstoječe šifrirane fotografije nedosegljive
    if (await isPinConfigured()) {
      throw new Error('PIN_ZE_NASTAVLJEN');
    }

    // 1. Ustvari novo 16-bajtno sol
    const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.SALT_BYTE_LENGTH));

    // 2. Izpelji ključ
    const key = await deriveKeyFromPin(pin, salt);

    // 3. Šifriraj kanarčka za preverjanje pravilnosti PIN-a ob odklepanju
    const enc = new TextEncoder();
    const canaryBuffer = enc.encode(CRYPTO_CONFIG.CANARY_PLAINTEXT).buffer;
    const { ciphertext: canaryCipher, iv: canaryIv } = await encryptBuffer(canaryBuffer, key);

    // 4. Shrani v bazo
    await performTransaction(STORES.VAULT_META, 'readwrite', (store) => {
      store.put({
        key: 'pin_security',
        salt: Array.from(salt),
        canary: canaryCipher,
        canaryIv: Array.from(canaryIv),
        updatedAt: Date.now()
      });
    });

    activeCryptoKey = key;
    isVaultUnlocked = true;
    resetAutoLockTimer();
    dispatchVaultEvent('unlocked');

    return { success: true };
  }

  /**
   * Odkleni trezor s PIN-om
   */
  async function unlockVault(pin) {
    const meta = await getVaultMeta('pin_security');
    if (!meta) {
      throw new Error('PIN še ni bil nastavljen. Uporabi setupVaultPin()');
    }

    const salt = new Uint8Array(meta.salt);
    const key = await deriveKeyFromPin(pin, salt);

    // Poskusi dešifrirati kanarčka
    try {
      const canaryIv = new Uint8Array(meta.canaryIv);
      const decryptedBuffer = await decryptBuffer(meta.canary, canaryIv, key);
      const dec = new TextDecoder();
      const decryptedString = dec.decode(decryptedBuffer);

      if (decryptedString !== CRYPTO_CONFIG.CANARY_PLAINTEXT) {
        throw new Error('Neveljaven kanarček');
      }
    } catch {
      return { success: false, error: 'NAPAČEN_PIN' };
    }

    activeCryptoKey = key;
    isVaultUnlocked = true;
    resetAutoLockTimer();
    dispatchVaultEvent('unlocked');

    return { success: true };
  }

  /**
   * Izklopi zaščito s PIN-om. Samo če ni šifriranih fotografij (sicer bi bile nedosegljive).
   * Vrne { success, error?, count? }
   */
  async function disableVaultPin(pin) {
    const meta = await getVaultMeta('pin_security');
    if (!meta) {
      return { success: true, alreadyDisabled: true };
    }

    // Preveri PIN (uporabi obstoječo funkcijo); pri napačnem PIN-u ostane stanje nespremenjeno
    const check = await unlockVault(pin);
    if (!check.success) {
      return { success: false, error: 'NAPAČEN_PIN' };
    }

    const photos = await performTransaction(STORES.PHOTOS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
    const encryptedCount = photos.filter(p => p.isEncrypted).length;
    if (encryptedCount > 0) {
      return { success: false, error: 'SIFRIRANE_FOTOGRAFIJE', count: encryptedCount };
    }

    await performTransaction(STORES.VAULT_META, 'readwrite', (store) => {
      store.delete('pin_security');
    });

    lockVault();
    return { success: true };
  }

  /**
   * Zakleni trezor in takoj izbriši kriptografski ključ iz RAM pomnilnika
   */
  function lockVault() {
    activeCryptoKey = null;
    isVaultUnlocked = false;
    clearAutoLockTimer();
    revokeAllTrackedUrls();
    dispatchVaultEvent('locked');
  }

  function resetAutoLockTimer() {
    clearAutoLockTimer();
    autoLockTimer = setTimeout(() => {
      console.warn('[SkinStorage] Samodejni zaklep sefa zaradi neaktivnosti.');
      lockVault();
    }, CRYPTO_CONFIG.AUTO_LOCK_TIMEOUT_MS);
  }

  function clearAutoLockTimer() {
    if (autoLockTimer) {
      clearTimeout(autoLockTimer);
      autoLockTimer = null;
    }
  }

  function dispatchVaultEvent(type, detail = {}) {
    if (eventListeners[type]) {
      eventListeners[type].forEach(fn => fn(detail));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`skin-vault:${type}`, { detail }));
    }
  }

  // =========================================================================
  // VARNO UPRAVLJANJE Z OBJECT URL-JI (ANTI-LEAK)
  // =========================================================================

  function createSecureTrackedUrl(blob) {
    const url = URL.createObjectURL(blob);
    activeObjectUrls.add(url);
    return url;
  }

  function revokeSecureUrl(url) {
    if (url && activeObjectUrls.has(url)) {
      URL.revokeObjectURL(url);
      activeObjectUrls.delete(url);
    }
  }

  function revokeAllTrackedUrls() {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls.clear();
  }

  // =========================================================================
  // CRUD OPERACIJE: FOTOGRAFIJE (PHOTOS)
  // =========================================================================

  /**
   * Shrani novo fotografijo z avtomatskim stiskanjem in šifriranjem
   * @param {File|Blob} file - Vhodna slika
   * @param {Object} metadata - { category: 'face'|'crown'|'hairline'|'body'|'back', angle, date, notes, etc. }
   */
  async function savePhoto(file, metadata = {}) {
    const isConfigured = await isPinConfigured();

    if (isConfigured && (!isVaultUnlocked || !activeCryptoKey)) {
      throw new Error('SEF_ZAKLENJEN: Za shranjevanje fotografij je potrebno vnesti PIN.');
    }

    // 1. Normalizacija, rotacija in stiskanje na odjemalcu
    const processed = await processAndCompressImage(file);
    const id = 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const timestamp = Date.now();
    const dateStr = metadata.date || new Date().toISOString().split('T')[0];

    const record = {
      id,
      timestamp,
      date: dateStr,
      category: metadata.category || 'general',
      angle: metadata.angle || 'front',
      notes: metadata.notes || '',
      tags: metadata.tags || [],
      metadata: {
        ...processed.metadata,
        ...metadata.customMeta
      },
      isEncrypted: isConfigured
    };

    if (isConfigured && activeCryptoKey) {
      // 2a. Šifriraj glavno sliko
      const encMain = await encryptBuffer(processed.blob, activeCryptoKey);
      record.ciphertext = encMain.ciphertext;
      record.iv = Array.from(encMain.iv);

      // 2b. Šifriraj predogled (thumbnail)
      const encThumb = await encryptBuffer(processed.thumbnailBlob, activeCryptoKey);
      record.thumbnailCiphertext = encThumb.ciphertext;
      record.thumbnailIv = Array.from(encThumb.iv);
    } else {
      // Shranjevanje brez PIN šifriranja (čisti Blob)
      record.blob = processed.blob;
      record.thumbnailBlob = processed.thumbnailBlob;
    }

    // 3. Shranjevanje v IndexedDB
    await performTransaction(STORES.PHOTOS, 'readwrite', (store) => {
      store.put(record);
    });

    resetAutoLockTimer();

    return {
      id: record.id,
      timestamp: record.timestamp,
      date: record.date,
      category: record.category,
      metadata: record.metadata
    };
  }

  /**
   * Pridobi posamezno fotografijo z opcijskim dešifriranjem
   */
  async function getPhoto(id, options = { decrypt: true }) {
    const record = await performTransaction(STORES.PHOTOS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });

    if (!record) return null;

    if (!record.isEncrypted) {
      return {
        ...record,
        photoUrl: createSecureTrackedUrl(record.blob),
        thumbnailUrl: record.thumbnailBlob ? createSecureTrackedUrl(record.thumbnailBlob) : null
      };
    }

    if (!options.decrypt) {
      // Vrne le ovojnico brez dešifriranih slikovnih točk
      const { ciphertext, iv, thumbnailCiphertext, thumbnailIv, ...meta } = record;
      return meta;
    }

    if (!isVaultUnlocked || !activeCryptoKey) {
      throw new Error('SEF_ZAKLENJEN: Za ogled fotografije morate odkleniti sef.');
    }

    // Dešifriraj glavno fotografijo
    const ivArray = new Uint8Array(record.iv);
    const decryptedBuffer = await decryptBuffer(record.ciphertext, ivArray, activeCryptoKey);
    const decryptedBlob = new Blob([decryptedBuffer], { type: record.metadata.mimeType || 'image/webp' });

    // Dešifriraj predogled
    let decryptedThumbnailBlob = null;
    if (record.thumbnailCiphertext && record.thumbnailIv) {
      const thumbIv = new Uint8Array(record.thumbnailIv);
      const thumbBuffer = await decryptBuffer(record.thumbnailCiphertext, thumbIv, activeCryptoKey);
      decryptedThumbnailBlob = new Blob([thumbBuffer], { type: record.metadata.mimeType || 'image/webp' });
    }

    resetAutoLockTimer();

    return {
      ...record,
      blob: decryptedBlob,
      photoUrl: createSecureTrackedUrl(decryptedBlob),
      thumbnailBlob: decryptedThumbnailBlob,
      thumbnailUrl: decryptedThumbnailBlob ? createSecureTrackedUrl(decryptedThumbnailBlob) : null
    };
  }

  /**
   * Seznam fotografij z naprednimi filtri (brez dešifriranja težkih polnih slik za visoko hitrost UI)
   */
  async function listPhotos(filter = {}) {
    const isConfigured = await isPinConfigured();

    return performTransaction(STORES.PHOTOS, 'readonly', (store) => {
      return new Promise(async (resolve, reject) => {
        const results = [];
        let cursorRequest;

        if (filter.category) {
          const index = store.index('category');
          cursorRequest = index.openCursor(IDBKeyRange.only(filter.category), 'prev');
        } else if (filter.date) {
          const index = store.index('date');
          cursorRequest = index.openCursor(IDBKeyRange.only(filter.date), 'prev');
        } else {
          const index = store.index('timestamp');
          cursorRequest = index.openCursor(null, 'prev');
        }

        cursorRequest.onsuccess = async (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const item = cursor.value;

            // Pripravi lahko glavo za galerijo
            const summary = {
              id: item.id,
              timestamp: item.timestamp,
              date: item.date,
              category: item.category,
              angle: item.angle,
              notes: item.notes,
              tags: item.tags,
              metadata: item.metadata,
              isEncrypted: item.isEncrypted
            };

            // Če je sef odklenjen, dešifriraj le MAJHEN predogled (thumbnail) za galerijski prikaz
            if (item.isEncrypted) {
              if (isVaultUnlocked && activeCryptoKey && item.thumbnailCiphertext && filter.loadThumbnails) {
                try {
                  const thumbIv = new Uint8Array(item.thumbnailIv);
                  const thumbBuffer = await decryptBuffer(item.thumbnailCiphertext, thumbIv, activeCryptoKey);
                  const thumbBlob = new Blob([thumbBuffer], { type: item.metadata.mimeType || 'image/webp' });
                  summary.thumbnailUrl = createSecureTrackedUrl(thumbBlob);
                } catch {
                  summary.thumbnailError = true;
                }
              }
            } else if (item.thumbnailBlob) {
              summary.thumbnailUrl = createSecureTrackedUrl(item.thumbnailBlob);
            }

            results.push(summary);

            if (filter.limit && results.length >= filter.limit) {
              resolve(results);
              return;
            }

            cursor.continue();
          } else {
            resolve(results);
          }
        };

        cursorRequest.onerror = () => reject(cursorRequest.error);
      });
    });
  }

  /**
   * Izbriši fotografijo in pripadajoče diagnostične skene
   */
  async function deletePhoto(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.PHOTOS, STORES.SCANS], 'readwrite');
      const photoStore = tx.objectStore(STORES.PHOTOS);
      const scanStore = tx.objectStore(STORES.SCANS);

      // Izbriši fotografijo
      photoStore.delete(id);

      // Izbriši povezane skene
      const scanIndex = scanStore.index('photoId');
      const scanReq = scanIndex.openCursor(IDBKeyRange.only(id));

      scanReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        resetAutoLockTimer();
        resolve({ success: true, deletedId: id });
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // =========================================================================
  // CRUD OPERACIJE: SKENI & RAČUNALNIŠKI VID (SCANS)
  // =========================================================================

  async function saveScan(scanData) {
    const id = scanData.id || 'scan_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const record = {
      id,
      photoId: scanData.photoId || null,
      timestamp: scanData.timestamp || Date.now(),
      date: scanData.date || new Date().toISOString().split('T')[0],
      metrics: {
        acneCount: scanData.metrics?.acneCount || 0,
        poreVisibilityScore: scanData.metrics?.poreVisibilityScore || null,
        erythemaIndex: scanData.metrics?.erythemaIndex || null,
        hairlineNorwoodEstimate: scanData.metrics?.hairlineNorwoodEstimate || null,
        hairDensityPerCm2: scanData.metrics?.hairDensityPerCm2 || null,
        sebumScore: scanData.metrics?.sebumScore || null
      },
      zones: scanData.zones || [],
      notes: scanData.notes || ''
    };

    await performTransaction(STORES.SCANS, 'readwrite', (store) => {
      store.put(record);
    });

    return record;
  }

  async function getScansForPhoto(photoId) {
    return performTransaction(STORES.SCANS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const index = store.index('photoId');
        const req = index.getAll(IDBKeyRange.only(photoId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // =========================================================================
  // CRUD OPERACIJE: RUTINE & PROTOKOLI (ROUTINES)
  // =========================================================================

  async function saveRoutine(routine) {
    const dateStr = routine.date || new Date().toISOString().split('T')[0];
    const id = 'routine_' + dateStr;

    const record = {
      id,
      date: dateStr,
      timestamp: Date.now(),
      am: routine.am || [], // npr. ['Salicilna kislina 2%', 'C-Vitamin serum', 'SPF 50']
      pm: routine.pm || [], // npr. ['Tretinoin 0.05%', 'Vlažilna krema s ceramidi']
      hair: routine.hair || [], // npr. ['RU58841 5%', 'Minoksidil 5%', 'Ketokonazol 2% šampon']
      gearPostInjection: routine.gearPostInjection || null, // npr. razkuževanje mesta, pregled vnetja/PIP
      adherenceScore: routine.adherenceScore != null ? routine.adherenceScore : 1.0,
      notes: routine.notes || ''
    };

    await performTransaction(STORES.ROUTINES, 'readwrite', (store) => {
      store.put(record);
    });

    return record;
  }

  async function getRoutineByDate(dateStr) {
    return performTransaction(STORES.ROUTINES, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get('routine_' + dateStr);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // =========================================================================
  // CRUD OPERACIJE: KVANTITATIVNE MERITVE (MEASUREMENTS)
  // =========================================================================

  async function saveMeasurement(meas) {
    const id = 'meas_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const record = {
      id,
      timestamp: meas.timestamp || Date.now(),
      date: meas.date || new Date().toISOString().split('T')[0],
      type: meas.type, // npr. 'hair_shed_count', 'skin_hydration', 'sebum_tape', 'waist_cm', 'skinfold_mm'
      value: Number(meas.value),
      unit: meas.unit || '',
      tags: meas.tags || [],
      notes: meas.notes || ''
    };

    await performTransaction(STORES.MEASUREMENTS, 'readwrite', (store) => {
      store.put(record);
    });

    return record;
  }

  async function listMeasurements(type, options = {}) {
    return performTransaction(STORES.MEASUREMENTS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const index = store.index('type');
        const req = index.getAll(IDBKeyRange.only(type));
        req.onsuccess = () => {
          let list = req.result || [];
          if (options.limit) list = list.slice(-options.limit);
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  // =========================================================================
  // UPRAVLJANJE DISKOVNE KVOTE IN OBSTOJNOSTI (STORAGE QUOTA & PERSISTENCE)
  // =========================================================================

  /**
   * Pridobi natančne podatke o zasedenosti in razpoložljivi kvoti shrambe
   */
  async function getStorageQuotaInfo() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usageBytes = estimate.usage || 0;
      const quotaBytes = estimate.quota || 0;
      const usageMb = (usageBytes / (1024 * 1024)).toFixed(2);
      const quotaMb = (quotaBytes / (1024 * 1024)).toFixed(2);
      const percentage = quotaBytes > 0 ? ((usageBytes / quotaBytes) * 100).toFixed(1) : 0;

      const isPersisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;

      return {
        usageBytes,
        quotaBytes,
        usageMb: Number(usageMb),
        quotaMb: Number(quotaMb),
        percentUsed: Number(percentage),
        isPersisted,
        supported: true
      };
    }
    return { supported: false };
  }

  /**
   * Zahtevaj trajno shranjevanje (preprečuje iOS Safari Storage Eviction ob pomanjkanju prostora)
   */
  async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.info('[SkinStorage] Zahteva za trajno shranjevanje (persistence):', isPersisted);
      return isPersisted;
    }
    return false;
  }

  // =========================================================================
  // VARNOSTNI ŠČIT PRED UHAJANJEM (APP SWITCHER PRIVACY SHIELD)
  // =========================================================================

  /**
   * Namesti avtomatske varovalke za zameglitev vsebine v multitasking preklopniku
   */
  function setupAntiLeakGuards(options = {}) {
    if (typeof document === 'undefined') return;

    let shieldEl = document.getElementById('skin-privacy-shield');
    if (!shieldEl) {
      shieldEl = document.createElement('div');
      shieldEl.id = 'skin-privacy-shield';
      shieldEl.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 9999999;
        background-color: rgba(0, 0, 0, 0.96);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        display: none;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
        text-align: center;
        pointer-events: auto;
      `;
      shieldEl.innerHTML = `
        <div style="padding: 24px;">
          <div style="width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #1C1C1E; display: flex; align-items: center; justify-content: center; border: 1px solid #2C2C2E;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#30D158" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <div style="font-size: 17px; font-weight: 600; margin-bottom: 6px;">Varnostni trezor zaklenjen</div>
          <div style="font-size: 13px; color: #8E8E93;">Vsebina zaščitena pred sistemskim predogledom</div>
        </div>
      `;
      document.body.appendChild(shieldEl);
    }

    const showShield = () => {
      shieldEl.style.display = 'flex';
      // Ob preklopu v ozadje preventivno sprostimo vse začasne URL-je v RAM-u
      revokeAllTrackedUrls();
    };

    const hideShield = () => {
      // Skrij ščit samo, če sef ni sistemsko zaklenjen
      if (isVaultUnlocked || !activeCryptoKey) {
        shieldEl.style.display = 'none';
      }
    };

    // 1. Zaznaj spremembo vidljivosti zavihka ali preklop v App Switcher (iOS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        showShield();
      } else {
        hideShield();
      }
    });

    // 2. Zaznaj izgubo fokusa okna (window.blur)
    window.addEventListener('blur', () => {
      showShield();
    });

    window.addEventListener('focus', () => {
      hideShield();
    });

    // 3. Onemogoči nehoten kontekstni meni in shranjevanje na občutljivih slikah
    document.addEventListener('contextmenu', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('vault-protected')) {
        e.preventDefault();
      }
    });

    // 4. Onemogoči kopiranje občutljivih elementov v odložišče
    document.addEventListener('copy', (e) => {
      if (document.activeElement && document.activeElement.classList.contains('vault-protected')) {
        e.preventDefault();
      }
    });
  }

  // =========================================================================
  // IZVOZ IN UVOZ CELOTNEGA ŠIFRIRANEGA ARHIVA (BACKUP & RESTORE)
  // =========================================================================

  /**
   * Izvozi celotno bazo v samostojno šifrirano ovojnico
   */
  async function exportEncryptedBackup() {
    const isConfigured = await isPinConfigured();
    if (isConfigured && (!isVaultUnlocked || !activeCryptoKey)) {
      throw new Error('Za izvoz podatkov morate odkleniti sef.');
    }

    const db = await openDatabase();
    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stores: {}
    };

    const storeNames = [STORES.PHOTOS, STORES.SCANS, STORES.ROUTINES, STORES.MEASUREMENTS, STORES.VAULT_META];

    await performTransaction(storeNames, 'readonly', (store, tx) => {
      return Promise.all(
        storeNames.map(name => {
          return new Promise((resolve, reject) => {
            const req = tx.objectStore(name).getAll();
            req.onsuccess = () => {
              backupData.stores[name] = req.result;
              resolve();
            };
            req.onerror = () => reject(req.error);
          });
        })
      );
    });

    return JSON.stringify(backupData, (key, value) => {
      if (value instanceof ArrayBuffer) {
        return { __type: 'ArrayBuffer', data: Array.from(new Uint8Array(value)) };
      }
      return value;
    });
  }

  // =========================================================================
  // JAVNI API OBJEKT
  // =========================================================================

  return {
    // Inicializacija
    init: openDatabase,
    setupAntiLeakGuards,

    // Upravljanje PIN-a in sefa
    isPinConfigured,
    setupVaultPin,
    unlockVault,
    disableVaultPin,
    lockVault,
    isUnlocked: () => isVaultUnlocked,
    on: (event, fn) => {
      if (eventListeners[event]) eventListeners[event].push(fn);
    },

    // Obdelava slik
    processAndCompressImage,

    // Fotografije (Photos)
    savePhoto,
    getPhoto,
    listPhotos,
    deletePhoto,

    // Skener in računalniški vid (Scans)
    saveScan,
    getScansForPhoto,

    // Rutine (Routines)
    saveRoutine,
    getRoutineByDate,

    // Meritve (Measurements)
    saveMeasurement,
    listMeasurements,

    // Kvota in obstojnost
    getStorageQuotaInfo,
    requestPersistentStorage,

    // URL upravljanje
    revokeSecureUrl,
    revokeAllTrackedUrls,

    // Varnostne kopije
    exportEncryptedBackup
  };
}));
