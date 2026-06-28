module.exports = {
  apps: [
    {
      name: 'bigwaveauto',
      script: 'dist/MotorDeal/server/server.mjs',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
    {
      name: 'vauto-sync',
      script: 'scripts/sync-vauto.mjs',
      instances: 1,
      autorestart: false,
      cron_restart: '*/30 * * * *',  // every 30 minutes
      watch: false,
      env: {
        NODE_ENV: 'production',
        VAUTO_DIR: '/home/vauto/inventory',
      },
    },
  ],
};
