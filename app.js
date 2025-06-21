const dotenv = require("dotenv");
const server = require('./build/server');

dotenv.config();

process.env.APP_ROOT = __dirname;

if (!process.env.DATA) {
  process.env.DATA = __dirname;
}

server.runServer();
