const { createApp } = require('./src/app');

const { app, config } = createApp();
app.listen(config.port, () => {
  console.log(`${config.siteName} listening on http://localhost:${config.port}`);
});
