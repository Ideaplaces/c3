module.exports = {
  apps: [
    {
      name: 'ccc',
      script: 'npx',
      args: 'tsx server.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: '8347',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/home/lucadev/.ccc/logs/ccc-error.log',
      out_file: '/home/lucadev/.ccc/logs/ccc-out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
