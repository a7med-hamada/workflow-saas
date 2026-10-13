const serverHandler = require('../src/server');

module.exports = (req, res) => {
  return serverHandler(req, res);
};
