const path = require('path');
const home = process.env.HOME || '/tmp';
const logsDir = path.join(home, '.c3', 'logs');

module.exports = {
  apps: [
    {
      name: 'c3',
      script: 'npx',
      args: 'tsx server.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'development',
        PORT: '8347',
      },
      watch: ['server.ts', 'src/lib', 'src/app/api'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', '.next', 'tests', '.git'],
      max_memory_restart: '500M',
      error_file: path.join(logsDir, 'c3-error.log'),
      out_file: path.join(logsDir, 'c3-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'c3-discord-bot',
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
      error_file: path.join(logsDir, 'discord-bot-error.log'),
      out_file: path.join(logsDir, 'discord-bot-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'c3-slack-poller',
      script: 'npx',
      args: 'tsx slack-poller.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        CCC_URL: 'http://localhost:8347',
      },
      watch: false,
      max_memory_restart: '200M',
      error_file: path.join(logsDir, 'slack-poller-error.log'),
      out_file: path.join(logsDir, 'slack-poller-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
