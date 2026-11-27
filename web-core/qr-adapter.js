(function () {
  const generator = window.QRCode;
  if (!generator || typeof generator.toCanvas !== 'function') return;
  window.QRCode = function (element, options) {
    generator.toCanvas(String(options.text || ''), { width: options.width || 148, margin: 1 }, function (error, canvas) {
      if (error) return;
      element.innerHTML = '';
      element.appendChild(canvas);
    });
  };
})();
