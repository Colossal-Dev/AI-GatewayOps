import mongoose from "mongoose";

const routeSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Project",
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
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },

    // Destination API URL
    upstreamUrl: {
      type: String,
      required: true,
      trim: true,
    },

    // Route-level response caching configuration
    cache: {
      enabled: {
        type: Boolean,
        default: false,
      },
      ttlSeconds: {
        type: Number,
        default: 300,
        min: 1,
      },
    },
  },
  { timestamps: true },
);

// Prevent duplicate routes within the same project
routeSchema.index({ projectId: 1, method: 1, path: 1 }, { unique: true });

const Route = mongoose.models.Route || mongoose.model("Route", routeSchema);

export default Route;
