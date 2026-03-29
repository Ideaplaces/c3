const path = require('path');
const home = process.env.HOME || '/tmp';
const logsDir = path.join(home, '.c3', 'logs');

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
      error_file: path.join(logsDir, 'ccc-error.log'),
      out_file: path.join(logsDir, 'ccc-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'ccc-discord-bot',
      script: 'npx',
      args: 'tsx discord-bot.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        CCC_URL: 'http://localhost:8347',
        BOT_PORT: '8348',
      },
      watch: false,
      max_memory_restart: '200M',
      error_file: path.join(logsDir, 'bot-error.log'),
      out_file: path.join(logsDir, 'bot-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'ccc-slack-poller',
      script: 'npx',
      args: 'tsx slack-poller.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        CCC_URL: 'http://localhost:8347',
      },
      watch: false,
      max_memory_restart: '200M',
      error_file: path.join(logsDir, 'slack-error.log'),
      out_file: path.join(logsDir, 'slack-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
