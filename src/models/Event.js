const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  eventType: {
    type: String,
    required: true,
  },
  subscriptionId: {
    type: String,
    default: '',
  },
  portalId: {
    type: String,
    default: '',
  },
  objectId: {
    type: String,
    required: true,
  },
  propertyName: String,
  propertyValue: String,
  changeSource: String,
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  retryCount: {
    type: Number,
    default: 0,
  },
  lastError: String,
  processedAt: Date,
}, {
  timestamps: true,
});

eventSchema.index({ status: 1 });
eventSchema.index({ objectId: 1, createdAt: -1 });

module.exports = mongoose.model('Event', eventSchema);
