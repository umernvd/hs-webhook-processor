const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema({
  hubspotDealId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  properties: {
    type: Map,
    of: String,
    default: {},
  },
  healthScore: {
    type: Number,
    default: null,
  },
  syncStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'synced'],
    default: 'pending',
  },
  errorMessage: {
    type: String,
    default: null,
  },
  lastSyncedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

dealSchema.index({ syncStatus: 1 });

module.exports = mongoose.model('Deal', dealSchema);
