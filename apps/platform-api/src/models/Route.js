import mongoose from 'mongoose';

const routeSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Project ID is required'],
      ref: 'Project',
      index: true,
    },
    path: {
      type: String,
      required: [true, 'Route path is required'],
      trim: true,
    },
    method: {
      type: String,
      required: [true, 'HTTP method is required'],
      trim: true,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

routeSchema.index({ projectId: 1, method: 1, path: 1 }, { unique: true });

const Route = mongoose.models.Route || mongoose.model('Route', routeSchema);

export default Route;
