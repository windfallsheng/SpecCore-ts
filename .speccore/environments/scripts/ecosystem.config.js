// =============================================================================
// PM2 生态配置模板
// =============================================================================
// 用途：PM2 进程管理配置（pm2 类型部署时调用）
// 位置：.speccore/environments/scripts/ecosystem.config.js
// 执行：speccore deploy --env <env> --platform <platform>
//
// 请根据实际项目修改 app 名称、脚本路径、环境变量等。
// =============================================================================

module.exports = {
  apps: [
    {
      name: 'notification-service',
      script: './dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_dev: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_test: {
        NODE_ENV: 'test',
        PORT: 3000,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '500M',
      restart_delay: 3000,
    },
  ],
};
