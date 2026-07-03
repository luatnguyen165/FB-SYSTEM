// models/Channel.js — SQLite adapter
const { getModel } = require('../scripts/sqlite-models');

const Channel = getModel('Channel');

module.exports = Channel;
