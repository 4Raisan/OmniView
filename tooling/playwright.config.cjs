module.exports = {
  outputDir: require('node:path').join(__dirname, 'test-results'),
  testDir: './tests', timeout: 30000, workers: 1,
  use: { trace: 'retain-on-failure' },
  reporter: 'list'
};
