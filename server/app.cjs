// Titik masuk untuk hosting cPanel ("Setup Node.js App": Phusion Passenger atau LiteSpeed lsnode).
// Isi kolom "Application startup file" dengan: app.cjs
import('./src/index.js')
  .then((m) => m.start())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
