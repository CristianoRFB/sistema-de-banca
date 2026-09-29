# Recursos locais de OCR

Estes arquivos só são solicitados quando a equipe escolhe importar uma foto ou um PDF escaneado. O service worker os armazena depois do primeiro uso; eles não entram no precache inicial da PWA.

- `worker.min.js`: pacote `tesseract.js` 7.0.0, Apache-2.0.
- `core/`: binários WebAssembly LSTM do pacote `tesseract.js-core` 7.0.0, Apache-2.0. A variante SIMD é preferida; a variante LSTM sem SIMD serve como fallback.
- `../tessdata/{por,eng,jpn}.traineddata.gz`: modelos `tessdata_fast` do projeto oficial Tesseract OCR, Apache-2.0. Os três idiomas são inicializados juntos sob demanda.

Os textos Apache-2.0 correspondentes estão nos arquivos `LICENSE-*.txt` desta pasta. Os arquivos-fonte usados para gerar os modelos compactados estão disponíveis em [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), revisão `87416418657359cb625c412a48b6e1d6d41c29bd`. O worker e core correspondem à tag `v7.0.0` de [tesseract.js](https://github.com/naptha/tesseract.js), revisão `b5cff0bca691a99ff69f1b162184e6c5a78629ef`.

As imagens e páginas renderizadas são processadas na memória local do navegador e descartadas ao final da importação. Nenhuma imagem original é enviada ao Worker ou salva na banca.
