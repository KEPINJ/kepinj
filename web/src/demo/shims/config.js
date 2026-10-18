// Pengganti server/src/config.js untuk mode demo di browser
export const config = {
  databaseUrl: 'pglite:idb://bku-demo',
  jwtSecret: 'demo-browser',
  kafkaBrokers: [],
  kafkaTopic: 'bku.events',
  maxUploadMb: 50,
  isProd: false,
};
