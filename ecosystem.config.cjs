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
        NODE_ENV: process.env.C3_DEV === 'true' ? 'development' : 'production',
        PORT: '8347',
      },
      watch: process.env.C3_DEV === 'true' ? ['server.ts', 'src/lib', 'src/app/api'] : false,
      watch_delay: 1000,
      ignore_watch: ['node_modules', '.next', 'tests', '.git'],
      // Every c3 restart kills every live session (the SDK's claude children
      // die with the process). At 500M pm2 restarted c3 8 times in 2 days,
      // each one taking down whatever was running. The box has 64G; give the
      // process room and let restarts be rare, deliberate events.
      max_memory_restart: '2G',
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
    {
      name: 'c3-cron-scheduler',
      script: 'npx',
      args: 'tsx cron-scheduler.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        CCC_URL: 'http://localhost:8347',
        TZ: 'America/Toronto',
      },
      watch: false,
      max_memory_restart: '200M',
      error_file: path.join(logsDir, 'cron-scheduler-error.log'),
      out_file: path.join(logsDir, 'cron-scheduler-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
