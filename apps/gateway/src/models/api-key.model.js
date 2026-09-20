import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
  {
    keyId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    secretHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

const APIKey = mongoose.model('APIKey', apiKeySchema);

export default APIKey;
