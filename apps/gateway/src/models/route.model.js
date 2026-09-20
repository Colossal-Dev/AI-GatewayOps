import mongoose from 'mongoose';

const routeSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    path: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      required: true,
      trim: true,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  },
  {
    timestamps: true,
  }
);

routeSchema.index({ projectId: 1, method: 1, path: 1 }, { unique: true });

const Route = mongoose.model('Route', routeSchema);

export default Route;
