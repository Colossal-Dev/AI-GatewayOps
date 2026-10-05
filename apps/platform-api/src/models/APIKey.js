import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
  {
    keyId: {
      type: String,
      required: [true, 'Key ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Project ID is required'],
      ref: 'Project',
      index: true,
    },
    secretHash: {
      type: String,
      required: [true, 'Secret hash is required'],
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        delete ret.secretHash;
        return ret;
      },
    },
    toObject: {
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        delete ret.secretHash;
        return ret;
      },
    },
  }
);

const APIKey = mongoose.models.APIKey || mongoose.model('APIKey', apiKeySchema);

export default APIKey;
