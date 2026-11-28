/* ACCAD Trace — lecture continue du QR par la caméra arrière (BarcodeDetector, sinon lecteur local jsQR) */
(function (root) {
  'use strict';
  const A = root.ACCAD;
  A.scanner = {
    stream: null, raf: 0, active: false,
    stop() { A.scanner.active = false; cancelAnimationFrame(A.scanner.raf); if (A.scanner.stream) A.scanner.stream.getTracks().forEach((t) => t.stop()); A.scanner.stream = null; },
    async start(video, onText, onError) {
      A.scanner.stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('Caméra non disponible sur cet appareil.'); return; }
      try { A.scanner.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      catch (e) { onError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Autorisation de la caméra refusée. Autorisez la caméra dans les réglages du navigateur, puis appuyez sur Réessayer.' : 'Impossible d’ouvrir la caméra. Appuyez sur Réessayer.'); return; }
      video.srcObject = A.scanner.stream; video.setAttribute('playsinline', 'true'); try { await video.play(); } catch (e) { /* lecture auto déjà lancée */ }
      let detector = null; try { if ('BarcodeDetector' in root) detector = new root.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      A.scanner.active = true; let last = 0, busy = false;
      const tick = async (t) => {
        if (!A.scanner.active) return;
        A.scanner.raf = requestAnimationFrame(tick);
        if (busy || t - last < 120 || video.readyState < 2 || !video.videoWidth) return; last = t; busy = true;
        try {
          let text = '';
          if (detector) { const codes = await detector.detect(video); if (codes.length) text = codes[0].rawValue; }
          if (!text && root.jsQR) { const scale = Math.min(1, 640 / video.videoWidth); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale); ctx.drawImage(video, 0, 0, canvas.width, canvas.height); const img = ctx.getImageData(0, 0, canvas.width, canvas.height); const res = root.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (res) text = res.data; }
          if (text && A.scanner.active) { A.scanner.stop(); onText(text); }
        } catch (e) { /* image suivante */ } finally { busy = false; }
      };
      A.scanner.raf = requestAnimationFrame(tick);
    }
  };
})(window);
